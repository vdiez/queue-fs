let Client = require('node-nfsc');
let fs = require('fs-extra');
let path = require('path');
let sprintf = require('sprintf-js').sprintf;
let winston = require('winston');

function NFS(params) {
    let self = this;
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

    winston.debug("Opening NFS connection to " + self.params.host);
    return new Promise((resolve, reject) => {
        self.client = new Client.V3(self.params);
        self.client.mount((err, root) => {
            if (err) {
                winston.error("Error on NFS connection " + self.params.host + ": " + err);
                self.root = undefined;
                reject(err);
            }
            else {
                winston.debug("NFS connection to " + self.params.host + " established.");
                self.root = root;
                resolve();
            }
        });
    });
};

NFS.prototype.transfer_file = function (src, dst, progress) {
    let self = this;
    while (dst.startsWith('/')) dst = dst.slice(1);
    let filename = path.posix.basename(dst);
    let tmp = path.posix.join(path.posix.dirname(dst), ".tmp", filename);
    let all_paths = path.posix.dirname(tmp).split('/');
    let final_paths = path.posix.dirname(dst).split('/');
    let tmp_handler, final_handler;
    let src_stats;

    return new Promise((resolve, reject) => {
        self.queue = Promise.resolve(self.queue)
            .then(() => new Promise((resolve2, reject2) => fs.stat(src, (err, stats) => err && reject2({not_found: true}) || (src_stats = stats) && resolve2())))
            .then(() => self.open_connection())
            .then(() => {
                return all_paths.reduce((p, entry, i) => p.then((parent) => new Promise((resolve2, reject2) => {
                    if (i === final_paths.length) final_handler = parent;
                    self.client.lookup(parent, entry, (err, entry_obj, entry_attrs, parent_attr) => {
                        if (err) {
                            if (err.status === 'NFS3ERR_NOENT') self.client.mkdir(parent, entry, {mode: 0o755}, (err, new_entry, attrs, wcc) => !err && new_entry && resolve2(new_entry) || reject2(err));
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
                tmp_handler = handler;
                return new Promise((resolve2, reject2) => self.client.lookup(final_handler, filename, (err, entry, attrs) =>  {
                    if (err) resolve2();
                    else {
                        if (attrs.size === src_stats.size) {
                            resolve();
                            reject2({file_exists: true});
                        }
                        else self.client.remove(final_handler, filename, err =>  err && reject2(err) || resolve2());
                    }
                }))
            })
            .then(() => {
                return new Promise((resolve2, reject2) => self.client.lookup(tmp_handler, filename, (err, entry, attrs) =>  {
                    if (err) resolve2();
                    else {
                        if (attrs.size === src_stats.size) resolve2({tmp_exists: true});
                        else self.client.remove(tmp_handler, filename, err =>  err && reject2(err) || resolve2());
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
                        self.readStream.pause();
                        self.client.write(object, buffer.length, transferred, self.client.WRITE_DATA_SYNC, buffer, (err, commited, count, verf, wcc) => {
                            if (err) {
                                reject2(err);
                                self.readStream.destroy();
                            }
                            else self.readStream.resume();
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
            .then(() => new Promise((resolve2, reject2) => self.client.rename(tmp_handler, filename, final_handler, filename, err => err && reject2(err) || resolve2())))
            .then(() => resolve())
            .catch(err => err && err.file_exists && resolve() || reject(err) && (!err || !err.not_found) && self.close_connection());
    });
};

NFS.prototype.close_connection = function () {
    let self = this;
    if (self.client) self.client.unmount(err => {
        if (err) winston.error("Error disconnecting NGS mount: ", err);
        self.client = undefined;
    });
};

let workers = {};
let wamp = require('simple_wamp');

module.exports = function(actions, config) {
    if (!actions.hasOwnProperty('nfs')) {
        actions.nfs = function(file, params) {
            let target = params.target || './';
            let source = file.dirname;
            if (params.hasOwnProperty('source')) source = params.source;
            source = sprintf(source, file);
            if (!params.source_is_filename) source = path.posix.join(source, file.filename);
            target = sprintf(target, file);
            if (!params.target_is_filename) target = path.posix.join(target, file.filename);

            let destination = {host: params.host, exportPath: params.export_path, uid: params.uid, gid: params.gid};
            let destination_key = JSON.stringify(destination);
            if (!workers.hasOwnProperty(destination_key)) workers[destination_key] = new NFS(destination);

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