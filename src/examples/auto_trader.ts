import {BotLoginOptions, SteamBotData, LoginErrorType, SteamBot} from "../SteamBot";
import TradeOffer = TradeOfferManager.TradeOffer;

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

            bot.onNewOffer(trade => {

                console.log("New trade offer received, sender :  " + trade.partner + ", id : " + trade.id);

                console.log("-------- Items to give : " + trade.itemsToGive.length + " ------------");
                trade.itemsToGive.forEach(item => console.log(JSON.stringify(item)));


                console.log("-------- Items to receive : " + trade.itemsToReceive.length + " ------------");
                trade.itemsToReceive.forEach(item => console.log(JSON.stringify(item)));

                if(trade.itemsToGive.length == 0){
                    // accept all donations :)
                    console.log("Trade is a donation, accepting it...");
                    acceptTrade(trade);
                }
                else{
                    console.log("The trade contains items to give, you need to accept it manually");
                    // apply your own policy here
                }

            });

        })
        .catch((loginError) => {
            if(loginError.type == LoginErrorType.CaptchaRequired){
                console.log(loginError.error.captchaurl);
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

let acceptTrade = (trade: TradeOffer) => {
    trade.accept(false, (err, state) => {
        if(err){
            console.log("Trade accept error : " + err);
        }
        else{
            if(state == "accepted"){
                console.log("Trade accepted");
            }
            else if(state == "pending"){
                console.log("Trade is pending");
            }
            else if(state == "escrow"){
                console.log("Trade will be hold until " + trade.escrowEnds);
            }
            else{
                console.error("Unknown trade state : " + state);
            }
        }
    });
};

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








