let fs = require('fs-extra');
let path = require('path');
let sprintf = require('sprintf-js').sprintf;

module.exports = (actions, config) => {
    if (!actions.hasOwnProperty('copy')) {
        actions.copy = (file, params) => {
            if (!params || !params.hasOwnProperty('target')) throw "Target path not specified";
            let source = file.dirname;
            if (params.hasOwnProperty('source')) source = params.source;
            source = sprintf(source, file);
            if (!params.source_is_filename) source = path.posix.join(source, file.filename);
            let target = sprintf(params.target, file);
            if (!params.target_is_filename) target = path.posix.join(target, file.filename);
            let stats, final;

            return fs.stat(source)
                .then(result => {
                    stats = result;
                    if (!params.direct) {
                        final = target;
                        target = path.posix.join(path.dirname(target), ".tmp", path.basename(target));
                        return fs.ensureDir(path.dirname(target));
                    }
                    return fs.ensureDir(path.dirname(target))
                })
                .then(() => new Promise((resolve, reject) => {
                    let writeStream = fs.createWriteStream(target);
                    writeStream.on('close', () => function () {
                        if (!params.direct) resolve();
                        else {
                            fs.move(target, final, {overwrite: true}, err => {
                                if (err) reject(err);
                                else resolve();
                            });
                        }
                    });
                    writeStream.on('error', err => reject(err));

                    let readStream = fs.createReadStream(source);
                    readStream.on('error', err => reject(err));
                    readStream.pipe(writeStream);

                    if (params.publish) {
                        let transferred = 0;
                        let percentage = 0;
                        readStream.on('data', buffer => {
                            transferred += buffer.length;

                            let tmp = Math.round(transferred * 100 / stats.size);
                            if (percentage != tmp) {
                                percentage = tmp;
                                params.publish({current: transferred, total: stats.size, percentage: percentage});
                            }
                        });
                    }
                }));
        };
    }
    return actions;
};