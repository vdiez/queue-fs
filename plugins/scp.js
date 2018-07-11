let Client = require('ssh2').Client;
let fs = require('fs-extra');
let path = require('path');
let winston = require('winston');
let sprintf = require('sprintf-js').sprintf;

function SCP(params) {
    let self = this;
    self.client = undefined;
    self.sftp = undefined;
    self.writeStream = undefined;
    self.queue = undefined;

    self.params = {};
    self.params.host = params.host;
    self.params.readyTimeout = 60000;
    if (params.port) self.params.port = params.port;
    if (params.username) self.params.username = params.username;
    if (params.password) self.params.password = params.password;
}

SCP.prototype.open_connection = function() {
    let self = this;
    if (!!self.sftp) return Promise.resolve();

    winston.debug("Opening SCP connection to " + self.params.host);
    return new Promise((resolve, reject) => {
        self.client = new Client();
        self.client
            .on('ready', () => {
                self.client.sftp((err, sftp) => {
                    if (err) {
                        winston.error("Error on SCP connection " + self.params.host + " when opening SFTP stream: " + err);
                        reject(err);
                    }
                    else {
                        winston.debug("SCP connection to " + self.params.host + " established.");
                        self.sftp = sftp;
                        resolve();
                    }
                });
            })
            .on('error', err => {
                winston.error("Error on SCP connection " + self.params.host + ": " + err);
                self.client = undefined;
                self.sftp = undefined;
                reject(err);
            })
            .on('end', () => {
                winston.debug("SCP connection to " + self.params.host + " ended.");
                self.client = undefined;
                self.sftp = undefined;
                reject("Connection ended");
            })
            .on('close', err => {
                winston.debug("SCP connection to " + self.params.host + " ended.");
                self.client = undefined;
                self.sftp = undefined;
                reject("Connection closed: " + err);
            })
            .connect(self.params);
    });
};

SCP.prototype.stop = function() {
    let self = this;
    if (self.writeStream) self.writeStream.close();
};

SCP.prototype.create_path = function (dir) {
    let self = this;
    if (!dir || dir == "/" || dir == ".") return Promise.resolve();
    return new Promise((resolve, reject) => self.sftp.stat(dir, (err, stats) => err && resolve() || reject({exists: true})))
        .then(() => new Promise((resolve, reject) => self.sftp.mkdir(dir, err => !err && resolve() || err && err.code == 2 /*NO_SUCH_FILE*/ && reject({missing_parent: true}) || reject(err))))
        .catch(err => err.missing_parent && self.create_path(path.dirname(dir)).then(() => self.create_path(dir)) || err.exists || Promise.reject(err))
};

SCP.prototype.transfer_file = function (src, dst, progress) {
    let self = this;
    let tmp = path.posix.join(path.dirname(dst), ".tmp", path.basename(dst));
    let src_stats;

    return new Promise((resolve, reject) => {
        self.queue = Promise.resolve(self.queue)
            .then(() => new Promise((resolve2, reject2) => fs.stat(src, (err, stats) => err && reject2({not_found: true}) || (src_stats = stats) && resolve2())))
            .then(() => self.open_connection())
            .then(() => new Promise((resolve2, reject2) => self.sftp.stat(dst, (err, stats) => !err && (stats.size === src_stats.size) && resolve() && reject2({file_exists: true}) || resolve2())))
            .then(() => self.create_path(path.posix.join(path.dirname(dst), '.tmp')))
            .then(() => new Promise((resolve2, reject2) => {
                self.readStream = fs.createReadStream(src);
                self.writeStream = self.sftp.createWriteStream(tmp);
                self.writeStream.on('error', err => reject2(err));
                self.writeStream.on('close', () => resolve2());
                self.readStream.pipe(self.writeStream);

                if (progress) {
                    let transferred = 0;
                    let percentage = 0;
                    self.readStream.on('data', buffer => {
                        transferred += buffer.length;

                        let tmp = Math.round(transferred * 100 / src_stats.size);
                        if (percentage != tmp) {
                            percentage = tmp;
                            progress({
                                current: transferred,
                                total: src_stats.size,
                                percentage: percentage
                            });
                        }
                    });
                }
            }))
            .then(() => new Promise((resolve2, reject2) => self.sftp.rename(tmp, dst, err => err && reject2(err) || resolve2())))
            .then(() => resolve())
            .catch(err => err && err.file_exists && resolve() || reject(err) && (!err || !err.not_found) && self.close_connection());
    });
};

SCP.prototype.close_connection = function () {
    let self = this;
    if (self.client) self.client.end();
    self.client = undefined;
    self.sftp = undefined;
};

let workers = {};
let wamp = require('simple_wamp');

module.exports = (actions, config) => {
    if (!actions.hasOwnProperty('scp')) {
        actions.scp = (file, params) => Promise.resolve(typeof params === "function" ? params(file) : params)
            .then(params => {
                if (!params) throw "Missing parameters";
                let target = params.target || './';
                let source = file.dirname;
                if (params.hasOwnProperty('source')) source = params.source;
                source = sprintf(source, file);
                if (!params.source_is_filename) source = path.posix.join(source, file.filename);
                target = sprintf(target, file);
                if (!params.target_is_filename) target = path.posix.join(target, file.filename);

                let destination = {host: params.host, username: params.username, password: params.password, port: params.port};
                let destination_key = JSON.stringify(destination);
                if (!workers.hasOwnProperty(destination_key)) workers[destination_key] = new SCP(destination);

                let progress = undefined;
                let wamp_router = params.wamp_router || config.default_router;
                let wamp_realm = params.wamp_realm || config.default_realm;
                if (params.job_id && params.progress && wamp_router && wamp_realm) {
                    progress = progress => wamp(wamp_router, wamp_realm, 'publish', [params.topic || 'task_progress', [params.job_id, file, progress]]);
                }

                return workers[destination_key].transfer_file(source, target, progress);
            });
    }
    return actions;
};