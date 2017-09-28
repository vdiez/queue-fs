let fs = require('fs-extra');
let xml = require('libxmljs');
let moment = require('moment');

let parse_xml = function (file) {
    let result = {query: {clip_id: file.clip_id, "info.contact": {$exists: true}}};
    if (!file.extension.toLowerCase().endsWith('xml')) return result;
    return new Promise(function (resolve, reject) {
        fs.readFile(file.path, function (err, data) {
            if (!err) {
                try {
                    let json = xml.parseXmlString(data).root();
                    let delivery = {};
                    let tmp = json.get('/delivery/requested');
                    if (tmp) delivery.requested = moment(tmp.text().trim(), 'YYYY-MM-DD HH:mm:ss').toDate();
                    tmp = json.get('/delivery/name');
                    if (tmp) delivery.name = tmp.text().trim();
                    tmp = json.get('/delivery/description');
                    if (tmp) delivery.description = tmp.text().trim();
                    tmp = json.get('/delivery/contact/name');
                    if (tmp) delivery.contact = tmp.text().trim();
                    tmp = json.get('/delivery/contact/email');
                    if (tmp) delivery.email = tmp.text().trim();

                    result.update = {info: delivery};
                }
                catch (e) {}
            }
            resolve(result);
        });
    });
};

module.exports = parse_xml;