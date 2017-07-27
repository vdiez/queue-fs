let fs = require('fs-extra');

module.exports = function(actions) {
    if (!actions.hasOwnProperty('copy')) {
        actions.copy = function (params) {
            return new Promise(function (resolve, reject) {
                fs.copy(params.source, params.target, {overwrite: true}, function (err) {
                    if (err) reject(err);
                    else resolve();
                });
            });
        };
    }
    return actions;
};