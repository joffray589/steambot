import {BotLoginOptions, SteamBotData, LoginErrorType, SteamBot} from "../SteamBot";

let ReadLine = require('readline');
let fs = require('fs');

let lineReader = ReadLine.createInterface({
    "input": process.stdin,
    "output": process.stdout
});

let botLoginOption: BotLoginOptions = {};

let doLogin = (async (botData: SteamBotData) => {

    let bot = new SteamBot(botData);

    console.log("Login...");

    bot.login(botLoginOption)
    .then(async () => {
        console.log("You are now logged in");

        bot.chatLogon(200, "web");

        bot.onChatMessage(async (senderId: SteamID, text: string) => {
            console.log(senderId + " : " + text);

            if(text.startsWith('!trade')){
                let tokens = text.split(" ");
                let tradeUrl = tokens[1];

                let offer = await bot.createTradeOffer(tradeUrl);



            }
            else{
                bot.sendChatMessage(senderId, "hello " + senderId + " how are you?")
                    .then(() => {
                        console.log("Answer sended");
                    })
                    .catch((error) => {
                        console.error("Send answer error : " + error);
                        console.trace();
                    });
            }

        });


    })
    .catch((loginError) => {
        if(loginError.type == LoginErrorType.CaptchaRequired){
            console.log("Captcha required : " + loginError.error.captchaurl);
            lineReader.question("Captcha : ", (captcha: string) => {
                botLoginOption.captcha = captcha;
                doLogin(botData);
            });
        }
        else if(loginError.type == LoginErrorType.MailCodeRequired){
            console.log("An email has been sent to your address at ***." + loginError.error.emaildomain);
            lineReader.question("Mail Code : ", (code: string) => {
                botLoginOption.authCode = code;
                doLogin(botData);
            });
        }
        else if(loginError.type == LoginErrorType.MobileCodeRequired){
            lineReader.question("Steam Guard Code : ", (code: string) => {
                botLoginOption.twoFactorCode = code;
                doLogin(botData);
            });
        }
        else if(loginError.type == LoginErrorType.SteamCommunityError){
            console.error("SteamCommunityError : " + loginError.error);
        }
        else if(loginError.type == LoginErrorType.TradeOfferManagerError){
            console.error("TradeOfferManagerError : " + loginError.error);
        }
    });
});

let botData: SteamBotData = <SteamBotData>{
    username: "",
    password: "",
    pollDataDirectory: "data",
};

try{
    botData = <SteamBotData>JSON.parse(fs.readFileSync('testing_botdata.json', 'utf8'));
    doLogin(botData);
}
catch(error){
    lineReader.question("UserName : ", (username: string) => {
        lineReader.question("Password : ", (password: string) => {
            botData.username = username;
            botData.password = password;
            doLogin(botData);
        });
    });
}








