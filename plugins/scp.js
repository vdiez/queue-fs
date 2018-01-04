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
    if (self.is_connected()) return Promise.resolve();

    winston.debug("Opening SCP connection to " + self.params.host);
    return new Promise(function(resolve, reject) {
        self.client = new Client();
        self.client
            .on('ready', function () {
                self.client.sftp(function (err, sftp) {
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
            .on('error', function (err) {
                winston.error("Error on SCP connection " + self.params.host + ": " + err);
                self.client = undefined;
                self.sftp = undefined;
                reject(err);
            })
            .on('end', function () {
                winston.debug("SCP connection to " + self.params.host + " ended.");
                self.client = undefined;
                self.sftp = undefined;
                reject("Connection ended");
            })
            .on('close', function (err) {
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

SCP.prototype.create_path = function (sftp, rel_path, cb) {
    let self = this;
    if (!rel_path || rel_path == "/" || rel_path == ".") {
        cb();
        return;
    }
    sftp.stat(rel_path, function (err1, stats) {
        if (err1) {
            sftp.mkdir(rel_path, function (err2) {
                if (err2) {
                    winston.debug("Error[" + err2.code + "] " + err2 + " creating path: " + rel_path + " on SCP connection " + self.params.host);
                    if (err2.code == 2) { // NO_SUCH_FILE
                        self.create_path(sftp, path.dirname(rel_path), function () {
                            self.create_path(sftp, rel_path, cb);
                        });
                    }
                    else cb(err2);
                }
                else {
                    winston.debug("Created path: " + rel_path + " on SCP connection " + self.params.host);
                    cb();
                }
            });
        }
        else cb();
    });
};

SCP.prototype.transfer_file = function (src, dst, progress) {
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
                                    self.sftp.stat(dst, function (err, stats2) {
                                        if (!err && stats2.size == stats.size) {
                                            resolve();
                                            resolve2();
                                        }
                                        else {
                                            self.create_path(self.sftp, path.posix.join(path.dirname(dst), '.tmp'), function (err) {
                                                if (err) {
                                                    reject(err);
                                                    resolve2();
                                                }
                                                else {
                                                    let tmp = path.posix.join(path.dirname(dst), ".tmp", path.basename(dst));
                                                    self.writeStream = self.sftp.createWriteStream(tmp);
                                                    self.writeStream.on('error', function (err) {
                                                        reject(err);
                                                        resolve2();
                                                    });
                                                    self.writeStream.on('close', function () {
                                                        self.sftp.rename(tmp, dst, function(err) {
                                                            if (err) reject(err);
                                                            else resolve();
                                                            resolve2();
                                                        });
                                                    });
                                                    let readStream = fs.createReadStream(src);
                                                    readStream.pipe(self.writeStream);
                                                    if (progress) {
                                                        let transferred = 0;
                                                        let percentage = 0;
                                                        readStream.on('data', function (buffer) {
                                                            transferred += buffer.length;

                                                            let tmp = Math.round(transferred * 100 / stats.size);
                                                            if (percentage != tmp) {
                                                                percentage = tmp;
                                                                progress({
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

SCP.prototype.close_connection = function () {
    let self = this;
    if (self.client) self.client.end();
    self.client = undefined;
    self.sftp = undefined;
};

SCP.prototype.is_connected = function () {
    let self = this;
    return self.sftp;
};

let workers = {};
let wamp = require('simple_wamp');

module.exports = function(actions, config) {
    if (!actions.hasOwnProperty('scp')) {
        actions.scp = function(file, params) {
            let target = params.target || './';
            let source = file.dirname;
            if (params.hasOwnProperty('source')) source = params.source;
            source = sprintf(source, file);
            if (!params.source_is_filename) source = path.join(source, file.filename);
            target = sprintf(target, file);
            if (!params.target_is_filename) target = path.join(target, file.filename);

            let destination = {host: params.host, username: params.username, password: params.password, port: params.port};
            let destination_key = JSON.stringify(destination);
            if (!workers.hasOwnProperty(destination_key)) workers[destination_key] = new SCP(destination);

            let progress = undefined;
            let wamp_router = params.wamp_router || config.default_router;
            let wamp_realm = params.wamp_realm || config.default_realm;
            if (params.progress && wamp_router && wamp_realm) {
                progress = progress => wamp(wamp_router, wamp_realm, 'publish', [params.topic || 'task_progress', [file, progress]])
            }

            return workers[destination_key].transfer_file(source, target, progress);
        };
    }
    return actions;
};