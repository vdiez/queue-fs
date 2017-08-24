let Client = require('ftp');
let fs = require('fs-extra');
let path = require('path');
let sprintf = require('sprintf-js').sprintf;

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

    console.log("Opening FTP connection");
    return new Promise(function(resolve, reject) {
        self.client = new Client();
        self.client
            .on('ready', function () {
                resolve();
            })
            .on('error', function (err) {
                self.client = undefined;
                reject(err);
            })
            .on('end', function () {
                self.client = undefined;
                reject("Connection ended");
            })
            .on('close', function (err) {
                self.client = undefined;
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
                                    resolve("Stat failed. Skipping transfer of: " + src);
                                    resolve2();
                                }
                                else {
                                    self.client.size(dst, function (err, size) {
                                        if (!err && size == stats.size) {
                                            resolve("File already exists. Skipping transfer of: " + src);
                                            resolve2();
                                        }
                                        else {
                                            self.client.mkdir(path.dirname(dst), true, function (err) {
                                                if (err) {
                                                    reject(err);
                                                    resolve2();
                                                }
                                                else {
                                                    let readStream = fs.createReadStream(src);
                                                    let transferred = 0;
                                                    let percentage = 0;
                                                    readStream.on('data', function(buffer) {
                                                        transferred += buffer.length;

                                                        let tmp = Math.round(transferred * 100 / stats.size);
                                                        if (percentage != tmp) {
                                                            percentage = tmp;
                                                            if (progress) progress({current: transferred, size: stats.size, percentage: percentage});
                                                        }
                                                    });
                                                    let tmp = path.join(path.dirname(dst), "." + path.basename(dst));
                                                    self.client.put(readStream, tmp, function (err) {
                                                        if (err) {
                                                            reject(err);
                                                            resolve2();
                                                        }
                                                        else {
                                                            self.client.rename(tmp, dst, function(err) {
                                                                if (err) reject(err);
                                                                else resolve("Finished transfer of: " + src);
                                                                resolve2();
                                                            });
                                                        }
                                                    });
                                                }
                                            });
                                        }
                                    });
                                }
                            });
                        });
                    })
                    .catch((err) => {console.log("Error: "  + err); reject();});
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

module.exports = function(params) {
    let {box, box_idx, route, route_idx, server, transfer, config} = params;
    if (server.protocol !== 'ftp') throw "Server protocol does not match module. It should be ftp";
    let target = sprintf(server.file, transfer);
    let source = transfer.source;

    let destination = {host: server.ip, username: server.ftp.user, password: server.ftp.pass, port: server.ftp.port};

    let destination_key = JSON.stringify(destination);
    if (!workers.hasOwnProperty(destination_key)) workers[destination_key] = new FTP(destination);

    return workers[destination_key].transfer_file(source, target);
};