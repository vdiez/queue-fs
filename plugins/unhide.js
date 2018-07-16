let fs = require('fs-extra');
let path = require('path');
let sprintf = require('sprintf-js').sprintf;

module.exports = actions => {
    if (!actions.hasOwnProperty('unhide')) {
        actions.unhide = (file, params) => {
            let source = file.dirname;
            if (params && params.hasOwnProperty('source')) source = params.source;
            source = sprintf(source, file);
            if (!params || !params.source_is_filename) source = path.posix.join(source, file.filename);
            if (path.basename(source).startsWith('.')) {
                let target = path.posix.join(path.dirname(source), path.basename(source).replace(/^\.*/, ''));
                fs.move(source, target, {overwrite: true});
            }
            else resolve();
        };
    }
    return actions;
};