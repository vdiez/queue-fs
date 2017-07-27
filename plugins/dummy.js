module.exports = function(actions) {
    if (!actions.hasOwnProperty('dummy')) {
        actions.dummy = function(params) {
            return new Promise(function(resolve, reject) {
                setTimeout(function() {
                    resolve();
                }, 2000 + Math.floor(Math.random() * 5000));
            });
        };
    }
    return actions;
};