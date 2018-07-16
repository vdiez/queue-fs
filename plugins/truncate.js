let fs = require('fs-extra');
let path = require('path');
let sprintf = require('sprintf-js').sprintf;

module.exports = actions => {
    if (!actions.hasOwnProperty('truncate')) {
        actions.truncate = (file, params) => {
            let source = file.dirname;
            if (params && params.hasOwnProperty('source')) source = params.source;
            source = sprintf(source, file);
            if (!params || !params.source_is_filename) source = path.posix.join(source, file.filename);
            return fs.writeFile(source, '');
        };
    }
    return actions;
};