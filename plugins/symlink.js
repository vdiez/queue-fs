let fs = require('fs-extra');

module.exports = function(actions) {
    if (!actions.hasOwnProperty('symlink')) {
        actions.symlink = function(params) {
            return new Promise(function (resolve, reject) {
                fs.ensureSymlink(params.source, params.target, function (err) {
                    if (err) reject(err);
                    else resolve();
                });
            });
        };
    }
    return actions;
};