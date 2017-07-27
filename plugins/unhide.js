let fs = require('fs-extra');
let path = require('path');

module.exports = function(actions) {
    if (!actions.hasOwnProperty('unhide')) {
        actions.unhide = function(params) {
            return new Promise(function (resolve, reject) {
                if (path.basename(params.source).startsWith('.')) {
                    params.target = path.join(path.dirname(params.source), path.basename(params.source).replace(/^\.*/, ''));
                    fs.move(params.source, params.target, {overwrite: true}, function (err) {
                        if (err) reject(err);
                        else resolve();
                    });
                }
                else resolve();
            });
        };
    }
    return actions;
};