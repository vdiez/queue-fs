let nodemailer = require('nodemailer');
let smtp_server;

module.exports = actions => {
    if (!actions.hasOwnProperty('email')) {
        actions.email = (file, params) => {
            if (!smtp_server && !params.smtp_server) throw "Missing SMTP server parameters";
            if (params.smtp_server) smtp_server = params.smtp_server;

            let transporter = nodemailer.createTransport(smtp_server);
            let mailOptions = {
                from: params.from,
                to: params.recipient,
                subject: params.subject,
                text: params.body,
                attachments: params.attachments
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
