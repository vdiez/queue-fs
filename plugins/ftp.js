let Client = require('ftp');
let fs = require('fs-extra');
let path = require('path');
let sprintf = require('sprintf-js').sprintf;
let winston = require('winston');

function FTP(params) {
    let self = this;
    self.client = undefined;
    self.queue = undefined;

    self.params = {};
    self.params.host = params.host;
    if (params.port) self.params.port = params.port;
    if (params.username) self.params.user = params.username;
    if (params.password) self.params.password = params.password;
}

FTP.prototype.open_connection = function() {
    let self = this;
    if (!!self.client) return Promise.resolve();

    winston.debug("Opening FTP connection to " + self.params.host);
    return new Promise((resolve, reject) => {
        self.client = new Client();
        self.client
            .on('ready', () => {
                winston.debug("FTP connection to " + self.params.host + " established.");
                resolve();
            })
            .on('error', err => {
                self.client = undefined;
                winston.error("Error on FTP connection " + self.params.host + ": " + err);
                reject(err);
            })
            .on('end', () => {
                self.client = undefined;
                winston.debug("FTP connection to " + self.params.host + " ended.");
                reject("Connection ended");
            })
            .on('close', err => {
                self.client = undefined;
                winston.debug("FTP connection to " + self.params.host + " closed.");
                reject("Connection closed: " + err);
            })
            .connect(self.params);
    });
};

FTP.prototype.transfer_file = function (src, dst, progress) {
    let self = this;
    while (dst.startsWith('/')) dst = dst.slice(1);
    let tmp = path.posix.join(path.dirname(dst), ".tmp", path.basename(dst));
    let src_stats;

    return new Promise((resolve, reject) => {
        self.queue = Promise.resolve(self.queue)
            .then(() => new Promise((resolve2, reject2) => fs.stat(src, (err, stats) => err && reject2({not_found: true}) || (src_stats = stats) && resolve2())))
            .then(() => self.open_connection())
            .then(() => new Promise((resolve2, reject2) => self.client.size(dst, (err, size) => !err && (size === src_stats.size) && resolve() && reject2({file_exists: true}) || resolve2())))
            .then(() => new Promise((resolve2, reject2) => self.client.mkdir(path.posix.join(path.dirname(dst), ".tmp"), true, err => err && reject2(err) || resolve2())))
            .then(() => new Promise((resolve2, reject2) => {
                self.readStream = fs.createReadStream(src);
                self.client.put(self.readStream, tmp, err => err && reject2(err) || resolve2());
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
            .then(() => new Promise((resolve2, reject2) => self.client.rename(tmp, dst, err => err && reject2(err) || resolve2())))
            .then(() => resolve())
            .catch(err => err && err.file_exists && resolve() || reject(err) && (!err || !err.not_found) && self.close_connection());
    });
};

FTP.prototype.close_connection = function (hard) {
    let self = this;

    if (self.client) {
        if (hard) self.client.destroy();
        else self.client.end();
    }
    self.client = undefined;
};

let workers = {};
let wamp = require('simple_wamp');

module.exports = function(actions, config) {
    if (!actions.hasOwnProperty('ftp')) {
        actions.ftp = function(file, params) {
            let target = params.target || './';
            let source = file.dirname;
            if (params.hasOwnProperty('source')) source = params.source;
            source = sprintf(source, file);
            if (!params.source_is_filename) source = path.posix.join(source, file.filename);
            target = sprintf(target, file);
            if (!params.target_is_filename) target = path.posix.join(target, file.filename);

            let destination = {host: params.host, username: params.username, password: params.password, port: params.port};
            let destination_key = JSON.stringify(destination);
            if (!workers.hasOwnProperty(destination_key)) workers[destination_key] = new FTP(destination);

            let progress = undefined;
            let wamp_router = params.wamp_router || config.default_router;
            let wamp_realm = params.wamp_realm || config.default_realm;
            if (params.job_id && params.progress && wamp_router && wamp_realm) {
                progress = progress => wamp(wamp_router, wamp_realm, 'publish', [params.topic || 'task_progress', [params.job_id, file, progress]]);
            }

            return workers[destination_key].transfer_file(source, target, progress);
        };
    }
    return actions;
};