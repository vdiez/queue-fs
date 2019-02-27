let Client = require('node-nfsc');
let fs = require('fs-extra');
let path = require('path');
let sprintf = require('sprintf-js').sprintf;

function NFS(params, logger) {
    let self = this;
    self.logger = logger;
    self.client = undefined;
    self.queue = undefined;
    self.root = undefined;

    self.params = {};
    self.params.host = params.host;
    if (params.exportPath) self.params.exportPath = params.exportPath;
    if (params.uid) self.params.uid = params.uid;
    if (params.gid) self.params.gid = params.gid;
}

NFS.prototype.open_connection = function() {
    let self = this;
    if (self.root) return Promise.resolve();

    self.logger.debug("Opening NFS connection to " + self.params.host);
    return new Promise((resolve, reject) => {
        self.client = new Client.V3(self.params);
        self.client.mount((err, root) => {
            if (err) {
                self.logger.error("Error on NFS connection " + self.params.host + ": " + err);
                self.root = undefined;
                reject(err);
            }
            else {
                self.logger.debug("NFS connection to " + self.params.host + " established.");
                self.root = root;
                resolve();
            }
        });
    });
};

NFS.prototype.transfer_file = function (src, dst, progress, no_tmp) {
    let self = this;
    while (dst.startsWith('/')) dst = dst.slice(1);
    let filename = path.posix.basename(dst);
    let tmp = no_tmp && dst || path.posix.join(path.posix.dirname(dst), ".tmp", filename);
    let all_paths = path.posix.dirname(tmp).split('/');
    let final_paths = path.posix.dirname(dst).split('/');
    let tmp_handler, final_handler;
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
            .then(() => {
                return all_paths.reduce((p, entry, i) => p.then((parent) => new Promise((resolve2, reject2) => {
                    if (i === final_paths.length) final_handler = parent;
                    self.client.lookup(parent, entry, (err, entry_obj, entry_attrs, parent_attr) => {
                        if (err) {
                            if (err.status === 'NFS3ERR_NOENT') self.client.mkdir(parent, entry, {mode: 0o755}, (err, new_entry, attrs, wcc) => {
                                if (!err && new_entry) resolve2(new_entry);
                                else reject2(err);
                            });
                            else reject2(err);
                        }
                        else {
                            if (entry_attrs.type === "NF3DIR") resolve2(entry_obj);
                            else reject2(entry + " already exists and it's not a directory");
                        }
                    })
                })), Promise.resolve(self.root))
            })
            .then(handler => {
                if (no_tmp) return; //tmp handler is the final one with no_tmp
                tmp_handler = handler;
                return new Promise((resolve2, reject2) => self.client.lookup(final_handler, filename, (err, entry, attrs) =>  {
                    if (err) resolve2();
                    else {
                        if (attrs.size === src_stats.size) reject2({file_exists: true});
                        else self.client.remove(final_handler, filename, err => {
                            if (err) reject2(err);
                            else resolve2();
                        });
                    }
                }))
            })
            .then(() => {
                return new Promise((resolve2, reject2) => self.client.lookup(tmp_handler, filename, (err, entry, attrs) =>  {
                    if (err) resolve2();
                    else {
                        if (attrs.size === src_stats.size) {
                            if (no_tmp) reject2({file_exists: true});
                            else resolve2({tmp_exists: true});
                        }
                        else self.client.remove(tmp_handler, filename, err =>  {
                            if (err) reject2(err);
                            else resolve2();
                        });
                    }
                }))
            })
            .then(tmp_exists => tmp_exists || new Promise((resolve2, reject2) => {
                self.client.create(tmp_handler, filename, self.client.CREATE_GUARDED, { mode: 0o644 }, (err, object, obj_attrs) => {
                    if (err) return reject2(err);
                    let transferred = 0;
                    let percentage = 0;
                    self.readStream = fs.createReadStream(src, { highWaterMark: 32 * 1024 });
                    self.readStream.on('error', err => reject2(err));
                    self.readStream.on('close', () => resolve2());
                    self.readStream.on('data', buffer => {
                        self.client.write(object, buffer.length, transferred, self.client.WRITE_UNSTABLE, buffer, (err, commited, count, verf, wcc) => {
                            if (err) {
                                reject2(err);
                                self.readStream.destroy();
                            }
                        });
                        transferred += buffer.length;
                        if (progress) {
                            let tmp = Math.round(transferred * 100 / src_stats.size);
                            if (percentage != tmp) {
                                percentage = tmp;
                                progress({
                                    current: transferred,
                                    total: src_stats.size,
                                    percentage: percentage
                                });
                            }
                        }
                    });
                });
            }))
            .then(() => no_tmp || new Promise((resolve2, reject2) => self.client.rename(tmp_handler, filename, final_handler, filename, err => {
                if (err) reject2(err);
                else resolve2();
            })))
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

NFS.prototype.close_connection = function () {
    let self = this;
    if (self.client) self.client.unmount(err => {
        if (err) self.logger.error("Error disconnecting NGS mount: ", err);
        self.client = undefined;
    });
};

let workers = {};

module.exports = (actions, config) => {
    if (!actions.hasOwnProperty('nfs')) {
        actions.nfs = (file, params) => {
            if (!params) throw "Missing parameters";
            let target = params.target || './';
            let source = file.dirname;
            if (params.hasOwnProperty('source')) source = params.source;
            source = sprintf(source, file);
            if (!params.source_is_filename) source = path.posix.join(source, file.filename);
            target = sprintf(target, file);
            if (!params.target_is_filename) target = path.posix.join(target, file.filename);

            let destination = {host: params.host, exportPath: params.export_path, uid: params.uid, gid: params.gid};
            let destination_key = JSON.stringify(destination);
            if (!workers.hasOwnProperty(destination_key)) workers[destination_key] = new NFS(destination, config.logger);

            return workers[destination_key].transfer_file(source, target, params.publish, params.direct);
        };
    }
    return actions;
};