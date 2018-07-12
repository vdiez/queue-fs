let Client = require('@marsaud/smb2');
let fs = require('fs-extra');
let path = require('path');
let sprintf = require('sprintf-js').sprintf;

function SMB(params) {
    let self = this;
    self.readStream = undefined;
    self.queue = undefined;

    self.params = {};
    self.params.share = "\\\\" + params.host + "\\" + params.share;
    self.params.username = params.username;
    self.params.password = params.password;
    self.params.domain = params.domain;
    self.params.autoCloseTimeout = 0;
    if (params.port) self.params.port = params.port;
    self.client = new Client(self.params);
}

SMB.prototype.transfer_file = function (src, dst, progress, no_tmp) {
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
            .then(() => new Promise((resolve2, reject2) => self.client.getSize(dst.replace(/\//g, "\\"), (err, size) => {
                if (!err && (size === src_stats.size)) reject2({file_exists: true});
                else resolve2();
            })))
            .then(() => self.client.ensureDir(path.posix.dirname(tmp).replace(/\//g, "\\")))
            .then(() => new Promise((resolve2, reject2) => {
                self.client.createWriteStream(tmp.replace(/\//g, "\\"), (err, writeStream) => {
                    if (err) return reject2(err);
                    self.readStream = fs.createReadStream(src);
                    writeStream.on('finish', () => resolve2());
                    writeStream.on('error', err => reject2(err));
                    self.readStream.pipe(writeStream);
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
                });
            }))
            .then(() => no_tmp || self.client.rename(tmp.replace(/\//g, "\\"), dst.replace(/\//g, "\\")))
            .then(() => resolve())
            .catch(err => {
                if (err && err.file_exists) resolve();
                else {
                    reject(err);
                    if (!err || !err.not_found) self.close_connection()
                }
            });
    });
};

SMB.prototype.close_connection = function () {
    let self = this;
    if (self.client) self.client.close();
    self.client = undefined;
};

let workers = {};
let wamp = require('simple_wamp');

module.exports = (actions, config) => {
    if (!actions.hasOwnProperty('smb')) {
        actions.smb = (file, params) => Promise.resolve(typeof params === "function" ? params(file) : params)
            .then(params => {
                if (!params) throw "Missing parameters";
                let target = params.target || './';
                let source = file.dirname;
                if (params.hasOwnProperty('source')) source = params.source;
                source = sprintf(source, file);
                if (!params.source_is_filename) source = path.posix.join(source, file.filename);
                target = sprintf(target, file);
                if (!params.target_is_filename) target = path.posix.join(target, file.filename);

                let destination = {host: params.host, domain: params.domain, share: params.share, username: params.username, password: params.password, port: params.port};
                let destination_key = JSON.stringify(destination);
                if (!workers.hasOwnProperty(destination_key)) workers[destination_key] = new SMB(destination);

                let progress = undefined;
                let wamp_router = params.wamp_router || config.default_router;
                let wamp_realm = params.wamp_realm || config.default_realm;
                if (params.job_id && params.progress && wamp_router && wamp_realm) {
                    progress = progress => wamp(wamp_router, wamp_realm, 'publish', [params.topic || 'task_progress', [params.job_id, file, progress]]);
                }

                return workers[destination_key].transfer_file(source, target, progress, params.direct);
            });
    }
    return actions;
};