let fs = require('fs-extra');

module.exports = function(actions) {
    if (!actions.hasOwnProperty('move')) {
        actions.move = function(params) {
            return new Promise(function (resolve, reject) {
                fs.move(params.source, params.target, {overwrite: true}, function (err) {
                    if (err) reject(err);
                    else resolve();
                });
            });
        };
    }
    return actions;
};