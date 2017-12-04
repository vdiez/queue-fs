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
    if (self.is_connected()) return Promise.resolve();

    winston.debug("Opening FTP connection to " + self.params.host);
    return new Promise(function(resolve, reject) {
        self.client = new Client();
        self.client
            .on('ready', function () {
                winston.debug("FTP connection to " + self.params.host + " established.");
                resolve();
            })
            .on('error', function (err) {
                self.client = undefined;
                winston.error("Error on FTP connection " + self.params.host + ": " + err);
                reject(err);
            })
            .on('end', function () {
                self.client = undefined;
                winston.debug("FTP connection to " + self.params.host + " ended.");
                reject("Connection ended");
            })
            .on('close', function (err) {
                self.client = undefined;
                winston.debug("FTP connection to " + self.params.host + " closed.");
                reject("Connection closed: " + err);
            })
            .connect(self.params);
    });
};

FTP.prototype.transfer_file = function (src, dst, progress) {
    let self = this;

    return new Promise(function(resolve, reject) {
        self.queue = Promise.resolve(self.queue)
            .then(function() {
                return self.open_connection()
                    .then(function() {
                        return new Promise(function(resolve2, reject2) {
                            fs.stat(src, function (err, stats) {
                                if (err) {
                                    reject({exists: false});
                                    resolve2();
                                }
                                else {
                                    self.client.size(dst, function (err, size) {
                                        if (!err && size == stats.size) {
                                            resolve();
                                            resolve2();
                                        }
                                        else {
                                            self.client.mkdir(path.posix.join(path.dirname(dst), '.tmp'), true, function (err) {
                                                if (err) {
                                                    reject(err);
                                                    resolve2();
                                                }
                                                else {
                                                    let readStream = fs.createReadStream(src);
                                                    let tmp = path.posix.join(path.dirname(dst), ".tmp", path.basename(dst));
                                                    self.client.put(readStream, tmp, function (err) {
                                                        if (err) {
                                                            reject(err);
                                                            resolve2();
                                                        }
                                                        else {
                                                            self.client.rename(tmp, dst, function(err) {
                                                                if (err) reject(err);
                                                                else resolve();
                                                                resolve2();
                                                            });
                                                        }
                                                    });
                                                    if (progress) {
                                                        let transferred = 0;
                                                        let percentage = 0;
                                                        readStream.on('data', function (buffer) {
                                                            transferred += buffer.length;

                                                            let tmp = Math.round(transferred * 100 / stats.size);
                                                            if (percentage != tmp) {
                                                                percentage = tmp;
                                                                if (progress) progress({
                                                                    current: transferred,
                                                                    size: stats.size,
                                                                    percentage: percentage
                                                                });
                                                            }
                                                        });
                                                    }
                                                }
                                            });
                                        }
                                    });
                                }
                            });
                        });
                    })
                    .catch((err) => {reject(err);});
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

FTP.prototype.is_connected = function () {
    let self = this;
    return !!self.client;
};

let workers = {};
let wamp = require('simple_wamp');

module.exports = function(actions) {
    if (!actions.hasOwnProperty('ftp_upload')) {
        actions.ftp_upload = function(file, params) {
            let target = params.target || './';
            let source = file.dirname;
            if (params.hasOwnProperty('source')) source = params.source;
            source = sprintf(source, file);
            if (!params.source_is_filename) source = path.join(source, file.filename);
            target = sprintf(target, file);
            if (!params.target_is_filename) target = path.join(target, file.filename);

            let destination = {host: params.host, username: params.username, password: params.password, port: params.port};
            let destination_key = JSON.stringify(destination);
            if (!workers.hasOwnProperty(destination_key)) workers[destination_key] = new FTP(destination);

            let progress = undefined;
            let wamp_router = params.wamp_router || config.wamp_router;
            let wamp_realm = params.wamp_realm || config.wamp_realm;
            if (params.progress && wamp_router && wamp_realm) {
                progress = progress => wamp(wamp_router, wamp_realm, 'publish', [params.topic || 'task_progress', [file, progress]])
            }

            return workers[destination_key].transfer_file(source, target, progress);
        };
    }
    return actions;
};