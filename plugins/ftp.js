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
    if (params.secure) {
        self.params.secure = true;
        self.params.secureOptions = {rejectUnauthorized: false};
    }
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

FTP.prototype.transfer_file = function (src, dst, progress, no_tmp) {
    let self = this;
    while (dst.startsWith('/')) dst = dst.slice(1);
    let tmp = no_tmp && dst || path.posix.join(path.posix.dirname(dst), ".tmp", path.posix.basename(dst));
    let src_stats;

    return new Promise((resolve, reject) => {
        self.queue = Promise.resolve(self.queue)
            .then(() => new Promise((resolve2, reject2) => fs.stat(src, (err, stats) => {
                if (err) reject2({not_found: true});
                else {
                    src_stats = stats;
                    resolve2();
                }
            })))
            .then(() => self.open_connection())
            .then(() => new Promise((resolve2, reject2) => self.client.size(dst, (err, size) => {
                if (!err && (size === src_stats.size)) reject2({file_exists: true}) ;
                else resolve2();
            })))
            .then(() => new Promise((resolve2, reject2) => {
                if (path.posix.dirname(tmp) === ".") resolve2();
                else self.client.mkdir(path.posix.dirname(tmp), true, err => {
                    if (err) reject2(err);
                    else resolve2();
                })
            }))
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
            .then(() => no_tmp || new Promise((resolve2, reject2) => self.client.rename(tmp, dst, err => {
                if (err) reject2(err);
                else resolve2();
            })))
            .then(() => resolve())
            .catch(err => {
                if (err && err.file_exists) resolve();
                else {
                    reject(err);
                    if (!err || !err.not_found) self.close_connection();
                }
            });
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

module.exports = (actions, config) => {
    if (!actions.hasOwnProperty('ftp')) {
        actions.ftp = (file, params) => {
            if (!params) throw "Missing parameters";
            let target = params.target || './';
            let source = file.dirname;
            if (params.hasOwnProperty('source')) source = params.source;
            source = sprintf(source, file);
            if (!params.source_is_filename) source = path.posix.join(source, file.filename);
            target = sprintf(target, file);
            if (!params.target_is_filename) target = path.posix.join(target, file.filename);

            let destination = {host: params.host, username: params.username, password: params.password, port: params.port, secure: params.secure};
            let destination_key = JSON.stringify(destination);
            if (!workers.hasOwnProperty(destination_key)) workers[destination_key] = new FTP(destination);

            let progress = undefined;
            let wamp_router = params.wamp_router || config.default_router;
            let wamp_realm = params.wamp_realm || config.default_realm;
            if (params.job_id && params.progress && wamp_router && wamp_realm) {
                progress = progress => wamp(wamp_router, wamp_realm, 'publish', [params.topic || 'task_progress', [params.job_id, file, progress]]);
            }

            return workers[destination_key].transfer_file(source, target, progress, params.direct);
        };
    }
    return actions;
};