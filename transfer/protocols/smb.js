let Client = require('@marsaud/smb2');
let fs = require('fs-extra');
let path = require('path');
let winston = require('winston');

function SMB(params) {
    let self = this;
    self.client = undefined;
    self.readStream = undefined;
    self.queue = undefined;

    self.params = {};
    self.params.share = "\\\\" + params.host + "\\" + params.share;
    self.params.username = params.username;
    self.params.password = params.password;
    self.params.domain = params.domain;
    self.params.autoCloseTimeout = 0;
    if (params.port) self.params.port = params.port;
}

SMB.prototype.open_connection = function(){
    let self = this;
    if (self.is_connected()) return Promise.resolve();

    winston.debug("Opening SMB connection to " + self.params.host);
    self.client = new Client(self.params);

    return new Promise(function(resolve, reject) {
        self.client.connect(function (err) {
            if (err) {
                winston.error("Error on SMB connection " + self.params.share + ": " + err);
                self.client = undefined;
                reject(err);
            }
            else {
                winston.debug("SMB connection to " + self.params.share + " established.");
                resolve();
            }
        });
    });
};

SMB.prototype.stop = function() {
    let self = this;
    if (self.readStream) self.readStream.close();
};

SMB.prototype.transfer_file = function (src, dst, progress) {
    let self = this;

    return new Promise(function(resolve, reject) {
        self.queue = Promise.resolve(self.queue)
            .then(function() {
                return self.open_connection()
                    .then(function() {
                        if (dst.startsWith('/')) dst = dst.slice(1);
                        return new Promise(function(resolve2, reject2) {
                            fs.stat(src, function (err, stats) {
                                if (err) {
                                    reject({exists: false});
                                    resolve2();
                                }
                                else {
                                    self.client.getSize(dst.replace(/\//g, "\\"), function (err, size) {
                                        if (!err && size == stats.size) {
                                            resolve("File already exists. Skipping transfer of: " + src);
                                            resolve2();
                                        }
                                        else {
                                            let path_creation = undefined;
                                            let root_path = path.posix.dirname(dst);
                                            if (root_path != "." && root_path != "/") {
                                                path_creation = new Promise(function(resolve3, reject3) {
                                                    self.client.ensureDir(root_path.replace(/\//g, "\\"), function (err) {
                                                        if (err) reject3(err);
                                                        else resolve3();
                                                    });
                                                });
                                            }

                                            Promise.resolve(path_creation)
                                                .then(() => {
                                                    self.client.createWriteStream(dst.replace(/\//g, "\\"), function (err, writeStream) {
                                                        if (err) throw err;
                                                        else {
                                                            self.readStream = fs.createReadStream(src);
                                                            self.readStream.on('close', function () {
                                                                self.readStream = undefined;
                                                                resolve("Finished transfer of: " + src);
                                                                resolve2();
                                                            });
                                                            let transferred = 0;
                                                            let percentage = 0;
                                                            self.readStream.on('data', function(buffer) {
                                                                transferred += buffer.length;

                                                                let tmp = Math.round(transferred * 100 / stats.size);
                                                                if (percentage != tmp) {
                                                                    percentage = tmp;
                                                                    if (progress) progress({current: transferred, size: stats.size, percentage: percentage});
                                                                }
                                                            });
                                                            writeStream.on('error', function (err) {
                                                                reject(err);
                                                                resolve2();
                                                            });
                                                            self.readStream.pipe(writeStream);
                                                        }
                                                    });
                                                })
                                                .catch(() => {reject(); resolve2();});
                                        }
                                    });
                                }
                            });
                        })
                    })
                    .catch((err) => {reject(err);});
            });
    });
};

SMB.prototype.close_connection = function () {
    let self = this;
    if (self.client) self.client.close();
    self.client = undefined;
};

SMB.prototype.is_connected = function () {
    let self = this;
    return !!self.client;
};

let workers = {};

module.exports = function(params) {
    let {box, box_idx, route, route_idx, server, transfer, config} = params;
    if (server.protocol !== 'smb') throw "Server protocol does not match module. It should be smb";
    let target = sprintf(server.file, transfer);
    let source = transfer.source;

    let destination = {host: server.ip, username: server.smb.user, password: server.smb.pass, domain: server.smb.domain, port: server.smb.port};

    let destination_key = JSON.stringify(destination);
    if (!workers.hasOwnProperty(destination_key)) workers[destination_key] = new SMB(destination);

    return workers[destination_key].transfer_file(source, target);
};