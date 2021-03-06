var nodemailer = require('nodemailer');
var validator = require("email-validator");
const MongoClient = require('mongodb').MongoClient;
const fs = require('fs');
const CronJob = require('cron').CronJob;
const job = new CronJob({
    cronTime: '00 00 03 * * 1-5',
    'onTick': onTick,
    start: false
});

//job.start();

onTick();
function onTick(_config) {
    let config = _config ? _config : getConfig();
    if (config) {
        connectToDB(db => {
            if (db) {
                createTransport(transporter => {
                    findRecipients(db, config, (err, list, campaignID) => {
                        if (err) {
                            console.error(err);
                            db.close();
                            transporter.close();
                            return onTick(config);
                        }
                        sendToList(list, transporter, db, campaignID, config);
                    });
                });
            } else {
                return onTick(config);
            }
        });
    } else return null;
}


function connectToDB(callback) {
let url = 'mongodb://localhost:27017/mailsender';
    MongoClient.connect(url, function (err, db) {
        if (err) {
            console.error(err);
            return callback(null);
        }
        console.log("Connected correctly to server");
        return callback(db);
    });
}

function createTransport(callback) {
    let transporter = nodemailer.createTransport({
        host: 'smtp.prodazha-optom.ru',
        port: 465,
        pool: true,
        secure: true, // use TLS
        auth: {
            user: 'user1',
            pass: 'password1'
        },
        tls: {
            // do not fail on invalid certs
            rejectUnauthorized: false
        }
    });
    return callback(transporter);
}

function getConfig() {
    let today = new Date();
    let currentMonth = today.getMonth();
    let dayOfMonth = today.getDate();
    let dayOfWeek = today.getDay();

    let config = {
        group: `${dayOfWeek}`,
        text: '',
        html: '',
        subject: '',
        titleInDB : ''
    };
    if(currentMonth === 4) {
        if (dayOfMonth >= 1) {
            config.text = 'plain-text/protiv_braka.txt';
            config.html = 'indexes/protiv_braka.html';
            config.subject = 'Наш контроль качества продукции из Китая, без брака';
            config.titleInDB = 'Мы против брака-май';

        }
        if (dayOfMonth >= 8) {
            config.text = 'plain-text/troiniki.txt';
            config.html = 'indexes/troiniki.html';
            config.subject = 'Тройник тройнику рознь : 4 вида тройников и партия';
            config.titleInDB = 'Тройник тройнику рознь-май';
        }
        if (dayOfMonth >= 15) {
            config.text = 'plain-text/exclusive.txt';
            config.html = 'indexes/exclusive.html';
            config.subject = 'Эксклюзив: что есть на складе у нас, но часто нет у других';
            config.titleInDB = 'Эксклюзив: что есть на складе у нас, но часто нет у других - май';
        }
        if (dayOfMonth >= 22) {
            config.text = 'plain-text/klapany_obratnye_chugunnye.txt';
            config.html = 'indexes/klapany_obratnye_chugunnye.html';
            config.subject = 'Пожалуй, лучший выбор обратных чугунных клапанов ➡️';
            config.titleInDB = 'Пожалуй, лучший выбор обратных чугунных клапанов → - май';
        }
        if (dayOfMonth >= 29) {
            config.text = 'plain-text/bolshie_diametry.txt';
            config.html = 'indexes/bolshie_diametry.html';
            config.subject = 'Где выгодно купить большие диаметры запорной арматуры и элементов трубопровода?';
            config.titleInDB = 'Где выгодно купить большие диаметры запорной арматуры и элементов трубопровода? - май';
        }
    } else return null;
    return config;
}

function findRecipients(db, config, callback) {
    contacts_collection = db.collection('contacts');
    campaign_collection = db.collection('campaign');
    campaign_collection.findOne({title: config.titleInDB}, function (err, campaign) {
        if (campaign) {
            contacts_collection.aggregate([
                {
                    $match: {
                        "fields.group": config.group,
                        "status": "subscribe",
                        "activities.target": {
                            $ne: campaign._id
                        }
                    }
                },
                {
                    $project: {
                        email: 1,
                        _id: 1
                    }
                },
                {
                    $limit: 300
                }
                ], function (err, list) {
                if (err) return callback(new Error(err));
                console.log(`будет отправлено ${list.length}`);
                return callback(null, list, campaign._id);
            });
        } else {
            return callback(new Error(`Компании ${config.titleInDB} нет в базе данных!`));
        }
    });
}

function sendToList(list, transporter, db, campaignID, config) {
    let text = fs.readFileSync(config.text, 'utf8');
    let html = fs.readFileSync(config.html, 'utf8');
    let _campaignID = campaignID.toString();
    sendAsync(0);
    function sendAsync(offset) {
        if (offset === list.length) {
            if (list.length === 0) {
                db.close();
                console.log('Mongo connection close');
                transporter.close();
                console.log('SMTP connection close');
                return console.log('done!');
            } else {
                db.close();
                console.log('pause and restart');
                transporter.close();
                return setTimeout(function () {
                    onTick();
                }, 10000)
            }
        } else {
            let validateEmail = validator.validate(list[offset].email);
            if (validateEmail) {
                let _id = list[offset]._id.toString();
                let email = template(html, {
                    email: list[offset].email,
                    unsub: `http://prodazha-optom.ru/unsubscribe/${_id}/${_campaignID}`
                });
                email = addPixel(email, _campaignID, _id);
                let mailOptions = {
                    headers: {
                        "List-Unsubscribe": `<http://prodazha-optom.ru/unsubscribe/${_id}/${_campaignID}>`,
                        "list-id" : `<${config.subject}>`,
                        "X-User-ID": _id,
                        "X-Campaign-ID": _campaignID
                    },
                    envelope : {
                        from : '"Bounce" <abuse@prodazha-optom.ru>',
                        to : list[offset].email
                    },
                    replyTo : '"ТД Армасети" <sale@prodazha-optom.ru>',
                    from: '"ТД Армасети" <sale@prodazha-optom.ru>', // sender address
                    to: list[offset].email, // list of receivers
                    subject: config.subject,
                    text: template(text, {
                        email: list[offset].email,
                        unsub: `http://prodazha-optom.ru/unsubscribe/${_id}/${_campaignID}`
                    }),// Subject line {email: item.email}
                    html: email // html body
                };
                transporter.sendMail(mailOptions, function (error, info) {
                    if (error) {
                        console.error(error);
                        console.error(`error, try reload [${list[offset].email}] \t\t ${offset} from ${list.length}`);
                        db.close();
                        transporter.close();
                        //return onTick(config);
                    } else {
                        db.collection('contacts').updateOne({email: list[offset].email}, {
                            $push: {
                                activities: {
                                    action: 'queued',
                                    target: campaignID,
                                    timestamp: new Date()
                                }
                            }
                        }, function (err, resp) {
                            console.log(`[${config.group}-${config.titleInDB}] \t [${list[offset].email}] \t ${offset} from ${list.length}`);
                            sendAsync(offset + 1);
                        });
                    }
                });
            } else {
                db.collection('contacts').remove({email: list[offset].email}, function () {
                    console.log(`[${list[offset].email}] \t\t ${offset} from ${list.length} remove`);
                    sendAsync(offset + 1);
                });
            }
        }
    }
}

function addPixel(emailWithoutAnchor, campaignID, contactID) {
    let pixel = `<img src="http://prodazha-optom.ru/tracker/${contactID}/${campaignID}" alt="pixel" style="-ms-interpolation-mode:bicubic;clear:both;display:block;max-width:100%;outline:0;text-decoration:none;width:auto">`;
    return emailWithoutAnchor.replace(/<body\b[^>]*>/,`$&${pixel}`);
}

function template(text, option){
    return Object.keys(option).reduce(function (sum, current) {
        return sum.replace(new RegExp(`\\[\\(${current}\\)\\]`, 'gi'),option[current]);
    },text);
}
