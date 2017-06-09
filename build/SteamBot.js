"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const events_1 = require("events");
const util_1 = require("util");
const SteamCommunity = require("steamcommunity");
const SteamTotp = require("steam-totp");
const TradeOfferManager = require("steam-tradeoffer-manager");
let fs = require("fs");
var TwoFactorState;
(function (TwoFactorState) {
    TwoFactorState[TwoFactorState["Locked"] = 0] = "Locked";
    TwoFactorState[TwoFactorState["Disabled"] = 1] = "Disabled";
    TwoFactorState[TwoFactorState["Enabled"] = 2] = "Enabled";
    TwoFactorState[TwoFactorState["Finalized"] = 3] = "Finalized";
})(TwoFactorState = exports.TwoFactorState || (exports.TwoFactorState = {}));
var LoginErrorType;
(function (LoginErrorType) {
    LoginErrorType[LoginErrorType["AlreadyLoggedIn"] = 0] = "AlreadyLoggedIn";
    LoginErrorType[LoginErrorType["MobileCodeRequired"] = 1] = "MobileCodeRequired";
    LoginErrorType[LoginErrorType["MailCodeRequired"] = 2] = "MailCodeRequired";
    LoginErrorType[LoginErrorType["CaptchaRequired"] = 3] = "CaptchaRequired";
    LoginErrorType[LoginErrorType["SteamCommunityError"] = 4] = "SteamCommunityError";
    LoginErrorType[LoginErrorType["TradeOfferManagerError"] = 5] = "TradeOfferManagerError";
})(LoginErrorType = exports.LoginErrorType || (exports.LoginErrorType = {}));
class LoginError {
    constructor(type, err) {
        this.type = type;
        this.error = util_1.error;
    }
}
exports.LoginError = LoginError;
exports.SteamBotEvent = {
    DataModified: "DataModified",
    LoggedIn: "LoggedIn"
};
class SteamBot extends events_1.EventEmitter {
    constructor(datas) {
        super();
        this._botDatas = datas;
        this._community = new SteamCommunity();
        this._loginSession = null;
        this._confirmationChecker = false;
        this._tradeOfferManager = new TradeOfferManager(this.tradeOfferManagerOptions);
        this._tradeOfferManager.on('pollData', pollData => this.writePollData(pollData));
        this._community.on("confKeyNeeded", (tag, callback) => {
            let time = Math.floor(Date.now() / 1000);
            let secret = this._botDatas.twoFactorIdentitySecret; // triggered when confirmation checker is running
            let key = SteamTotp.getConfirmationKey(secret, time, tag); //          => <secret> is set at this point
            callback(null, time, key);
        });
        if (fs.existsSync(this.pollDataFilePath)) {
            this._tradeOfferManager.pollData = JSON.parse(fs.readFileSync(this.pollDataFilePath).toString());
        }
    }
    login(options) {
        return new Promise((resolve, reject) => {
            if (this._loginSession != null) {
                reject(new LoginError(LoginErrorType.AlreadyLoggedIn));
            }
            console.log("2");
            let loginOptions = {
                accountName: this._botDatas.username,
                password: this._botDatas.password,
                authCode: options.authCode,
                captcha: options.captcha,
                twoFactorCode: options.twoFactorCode,
                steamguard: options.steamguard
            };
            console.log("3");
            if (this._botDatas.twoFactorState == TwoFactorState.Finalized) {
                loginOptions.twoFactorCode = SteamTotp.getAuthCode(this._botDatas.twoFactorSharedSecret);
            }
            this._community.login(loginOptions, (err, sessionID, cookies, steamguard) => {
                if (err) {
                    console.log("SteamCommunity.login error : " + err.message);
                    if (err.message == "SteamGuardMobile") {
                        reject(new LoginError(LoginErrorType.MobileCodeRequired));
                    }
                    else if (err.message == "SteamGuard") {
                        reject(new LoginError(LoginErrorType.MailCodeRequired));
                    }
                    else if (err.message == "CAPTCHA") {
                        reject(new LoginError(LoginErrorType.CaptchaRequired));
                    }
                    else {
                        reject(new LoginError(LoginErrorType.SteamCommunityError, err));
                    }
                }
                else {
                    this._loginSession = {
                        cookies: cookies, sessionID: sessionID, steamguard: steamguard
                    };
                    this._tradeOfferManager.setCookies(cookies, (err) => {
                        if (err) {
                            reject(new LoginError(LoginErrorType.TradeOfferManagerError, err));
                        }
                        else {
                            this._loginSession = {
                                cookies: cookies, sessionID: sessionID, steamguard: steamguard
                            };
                            this.emit(exports.SteamBotEvent.LoggedIn);
                            resolve();
                        }
                    });
                }
            });
        });
    }
    logout() {
        return new Promise((resolve, reject) => {
            this._community.loggedIn((err, loggedIn) => {
                if (err) {
                    reject(err);
                }
                else if (!loggedIn) {
                    reject(new Error("Not logged in"));
                }
                else {
                    this._loginSession = null;
                    this._community.setCookies(null);
                    this._tradeOfferManager.setCookies(null);
                    resolve();
                }
            });
        });
    }
    enableTotp() {
        return new Promise((resolve, reject) => {
            if (this._botDatas.twoFactorState == TwoFactorState.Locked) {
                reject(new Error("totp is locked"));
            }
            else if (this._botDatas.twoFactorState == TwoFactorState.Finalized) {
                reject(new Error("totp is already enabled and finalized"));
            }
            else if (this._loginSession == null) {
                reject(new Error("not logged in"));
            }
            else {
                this._community.enableTwoFactor((err, response) => {
                    if (err) {
                        if (err.eresult == 2) {
                            reject(new Error("no phone associated with this account"));
                        }
                        else if (err.eresult == 84) {
                            reject(new Error("rate limit exceeded, try again later"));
                        }
                        else {
                            reject(err);
                        }
                    }
                    else {
                        if (response.status != TradeOfferManager.EResult.OK) {
                            reject(new Error("bad response status"));
                        }
                        else {
                            this._botDatas.twoFactorState = TwoFactorState.Enabled;
                            this._botDatas.twoFactorSharedSecret = response.shared_secret;
                            this._botDatas.twoFactorRevocationCode = response.revocation_code;
                            this._botDatas.twoFactorIdentitySecret = response.identity_secret;
                            this.printTotpResponse(response);
                            this.emit(exports.SteamBotEvent.DataModified);
                            resolve();
                        }
                    }
                });
            }
        });
    }
    finalizeTotp(code) {
        return new Promise((resolve, reject) => {
            if (this._botDatas.twoFactorState == TwoFactorState.Locked) {
                reject(new Error("totp is locked"));
            }
            else if (this._botDatas.twoFactorState == TwoFactorState.Finalized) {
                reject(new Error("totp is already enabled and finalized"));
            }
            else if (this._botDatas.twoFactorState != TwoFactorState.Enabled) {
                reject(new Error("you must enable totp before finalize it"));
            }
            else if (this._loginSession == null) {
                reject(new Error("not logged in"));
            }
            else {
                let secret = this._botDatas.twoFactorSharedSecret;
                this._community.finalizeTwoFactor(secret, code, (err) => {
                    if (err) {
                        reject(new Error("steamCommunity.finalizeTwoFactor"));
                    }
                    else {
                        this._botDatas.twoFactorState = TwoFactorState.Finalized;
                        this.emit(exports.SteamBotEvent.DataModified);
                        resolve();
                    }
                });
            }
        });
    }
    ;
    disableTotp() {
        return new Promise((resolve, reject) => {
            if (this._botDatas.twoFactorState == TwoFactorState.Locked) {
                reject(new Error("totp is locked"));
            }
            else if (this._botDatas.twoFactorState != TwoFactorState.Finalized) {
                reject(new Error("totp is not enabled and finalized"));
            }
            else if (this._loginSession == null) {
                reject(new Error("not logged in"));
            }
            else {
                this._community.disableTwoFactor(this._botDatas.twoFactorRevocationCode, (err) => {
                    if (err) {
                        reject(new Error("steamCommunity.disableTwoFactor"));
                    }
                    else {
                        this._botDatas.twoFactorState = TwoFactorState.Disabled;
                        this._botDatas.twoFactorSharedSecret = "";
                        this._botDatas.twoFactorRevocationCode = "";
                        this._botDatas.twoFactorIdentitySecret = "";
                        this.emit(exports.SteamBotEvent.DataModified);
                        resolve();
                    }
                });
            }
        });
    }
    startConfirmationChecker() {
        return new Promise((resolve, reject) => {
            if (this._confirmationChecker === true) {
                reject(new Error("confirmation checker already running"));
            }
            else if (this._botDatas.twoFactorState != TwoFactorState.Finalized) {
                reject(new Error("totp is not finalized"));
            }
            else if (this._loginSession == null) {
                reject(new Error("not logged in"));
            }
            else {
                let pollInterval = this._botDatas.tradeOfferConfirmationPollInterval;
                let identitySecret = this._botDatas.twoFactorIdentitySecret;
                this._community.startConfirmationChecker(pollInterval, identitySecret);
                this._confirmationChecker = true;
                resolve();
            }
        });
    }
    stopConfirmationChecker() {
        return new Promise((resolve, reject) => {
            if (this._confirmationChecker === false) {
                reject(new Error("confirmation checker not running"));
            }
            else {
                this._community.stopConfirmationChecker();
                this._confirmationChecker = false;
                resolve();
            }
        });
    }
    checkConfirmations() {
        this._community.checkConfirmations();
    }
    getConfirmations() {
        return new Promise((resolve, reject) => {
            let time = Math.floor(Date.now() / 1000);
            let secret = this._botDatas.twoFactorIdentitySecret;
            let key = SteamTotp.getConfirmationKey(secret, time, "conf");
            this._community.getConfirmations(time, key, (err, confirmations) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(confirmations);
                }
            });
        });
    }
    answerConfirmation(confirmation, accept) {
        return new Promise((resolve, reject) => {
            let time = Math.floor(Date.now() / 1000);
            let secret = this._botDatas.twoFactorIdentitySecret;
            let key = SteamTotp.getConfirmationKey(secret, time, "details");
            confirmation.respond(time, key, accept, (err) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve();
                }
            });
        });
    }
    handleTradeRequest(request) {
        return __awaiter(this, void 0, void 0, function* () {
            return new Promise((resolve, reject) => {
                let offer = this._tradeOfferManager.createOffer(request.tradeUrl);
                resolve(offer);
            });
        });
    }
    /** ********** **/
    // Typed events handling
    onNewOffer(callback) {
        this._tradeOfferManager.on("newOffer", callback);
    }
    onSentOfferChanged(callback) {
        this._tradeOfferManager.on("sentOfferChanged", callback);
    }
    onSentOfferCanceled(callback) {
        this._tradeOfferManager.on("sentOfferCanceled", callback);
    }
    onSentPendingOfferCanceled(callback) {
        this._tradeOfferManager.on("sentPendingOfferCanceled", callback);
    }
    onUnknownOfferSent(callback) {
        this._tradeOfferManager.on("unknownOfferSent", callback);
    }
    onReceivedOfferChanged(callback) {
        this._tradeOfferManager.on("receivedOfferChanged", callback);
    }
    onPollFailure(callback) {
        this._tradeOfferManager.on("pollFailure", callback);
    }
    onPollSuccess(callback) {
        this._tradeOfferManager.on("pollSuccess", callback);
    }
    onPollData(callback) {
        this._tradeOfferManager.on("pollData", callback);
    }
    onSessionExpired(callback) {
        this._community.on("sessionExpired", callback);
    }
    /** ********** **/
    printTotpResponse(response) {
        console.log('#################');
        console.log('!! COPY THIS SOMEWHERE !!');
        console.log('TwoFactor ' + this._botDatas.username);
        console.log('shared_secret: ' + response.shared_secret);
        console.log('revocation_code: ' + response.revocation_code);
        console.log('identity_secret: ' + response.identity_secret);
        console.log('raw_response: ' + response);
        console.log('#################');
    }
    get tradeOfferManagerOptions() {
        return {
            domain: this._botDatas.tradeOfferDomain,
            language: "en",
            pollInterval: this._botDatas.tradeOfferPollInterval
        };
    }
    get pollDataFilePath() {
        return "data/bot_poll_data/" + this._botDatas.username + ".polldata.json";
    }
    writePollData(pollData) {
        fs.writeFile(this.pollDataFilePath, JSON.stringify(pollData));
    }
    /* *************** */
    get botDatas() {
        return this._botDatas;
    }
    get confirmationChecker() {
        return this._confirmationChecker;
    }
}
exports.SteamBot = SteamBot;
