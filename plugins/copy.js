let fs = require('fs-extra');
let path = require('path');
let sprintf = require('sprintf-js').sprintf;
let wamp = require('simple_wamp');

module.exports = (actions, config) => {
    if (!actions.hasOwnProperty('copy')) {
        actions.copy = (file, params) => Promise.resolve(typeof params === "function" ? params(file) : params)
            .then(params => {
                if (!params || !params.hasOwnProperty('target')) throw "Target path not specified";
                let source = file.dirname;
                if (params.hasOwnProperty('source')) source = params.source;
                source = sprintf(source, file);
                if (!params.source_is_filename) source = path.posix.join(source, file.filename);
                let target = sprintf(params.target, file);
                if (!params.target_is_filename) target = path.posix.join(target, file.filename);
                let stats;

                return fs.stat(source)
                    .then(result => {
                        stats = result;
                        return fs.ensureDir(path.dirname(target))
                    })
                    .then(() => new Promise((resolve, reject) => {
                        let writeStream = fs.createWriteStream(target);
                        writeStream.on('close', () => resolve());
                        writeStream.on('error', err => reject(err));

                        let readStream = fs.createReadStream(source);
                        readStream.on('error', err => reject(err));
                        readStream.pipe(writeStream);

                        let transferred = 0;
                        let percentage = 0;
                        let wamp_router = params.wamp_router || config.default_router;
                        let wamp_realm = params.wamp_realm || config.default_realm;
                        if (params.job_id && params.progress && wamp_router && wamp_realm) {
                            readStream.on('data', buffer => {
                                transferred += buffer.length;

                                let tmp = Math.round(transferred * 100 / stats.size);
                                if (percentage != tmp) {
                                    percentage = tmp;
                                    wamp(wamp_router, wamp_realm, 'publish', [params.topic || 'task_progress', [params.job_id, file, {current: transferred, total: stats.size, percentage: percentage}]]);
                                }
                            });
                        }
                    }));
            });
    }
    return actions;
};