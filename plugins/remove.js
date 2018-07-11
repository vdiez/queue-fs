let fs = require('fs-extra');
let path = require('path');
let sprintf = require('sprintf-js').sprintf;

module.exports = actions => {
    if (!actions.hasOwnProperty('remove')) {
        actions.remove = (file, params) => Promise.resolve(typeof params === "function" ? params(file) : params)
            .then(params => {
                let source = file.dirname;
                if (params && params.hasOwnProperty('source')) source = params.source;
                source = sprintf(source, file);
                if (!params || !params.source_is_filename) source = path.posix.join(source, file.filename);
                return fs.remove(source);
            });
    }
    return actions;
};