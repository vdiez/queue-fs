let fs = require('fs-extra');
let path = require('path');
let sprintf = require('sprintf-js').sprintf;

module.exports = actions => {
    if (!actions.hasOwnProperty('link')) {
        actions.link = (file, params) => Promise.resolve(typeof params === "function" ? params(file) : params)
            .then(params => {
                if (!params || !params.hasOwnProperty('target')) throw "Target path not specified";
                let source = file.dirname;
                if (params.hasOwnProperty('source')) source = params.source;
                source = sprintf(source, file);
                if (!params.source_is_filename) source = path.posix.join(source, file.filename);
                let target = sprintf(params.target, file);
                if (!params.target_is_filename) target = path.posix.join(target, file.filename);
                return fs.ensureLink(source, target);
            });
    }
    return actions;
};