let fs = require('fs-extra');
let path = require('path');
let sprintf = require('sprintf-js').sprintf;

module.exports = actions => {
    if (!actions.hasOwnProperty('move')) {
        actions.move = (file, params) => {
            if (!params || !params.hasOwnProperty('target')) throw "Target path not specified";
            let final, source = file.dirname;
            if (params.hasOwnProperty('source')) source = params.source;
            source = sprintf(source, file);
            if (!params.source_is_filename) source = path.posix.join(source, file.filename);
            let target = sprintf(params.target, file);
            if (!params.target_is_filename) target = path.posix.join(target, file.filename);

            if (!params.direct) {
                final = target;
                target = path.posix.join(path.dirname(target), ".tmp", path.basename(target));
            }
            return fs.move(source, target, {overwrite: true})
                .then(() => params.direct || fs.move(target, final, {overwrite: true}))
        };
    }
    return actions;
};