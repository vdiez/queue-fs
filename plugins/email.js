let nodemailer = require('nodemailer');

module.exports = (actions, config) => {
    if (!actions.hasOwnProperty('email')) {
        actions.email = (file, params) => {
            let transporter = nodemailer.createTransport(params.smtp_server || config.default_smtp_server);
            let mailOptions = {
                from: params.from || config.default_from,
                to: params.recipient,
                subject: params.subject,
                text: params.body
            };

            if (params.bcc) mailOptions.bcc = params.bcc;
            if (params.cc) mailOptions.cc = params.cc;

            return new Promise(function(resolve, reject) {
                transporter.sendMail(mailOptions, function (error, info) {
                    if (error) reject(error);
                    else resolve(info);
                });
            });
        };
    }
    return actions;
};
