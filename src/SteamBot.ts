import {EventEmitter} from "events";

import SteamID              = require("steamid");
import SteamCommunity       = require("steamcommunity");
import SteamTotp            = require("steam-totp");
import TradeOfferManager    = require("steam-tradeoffer-manager");

import CConfirmation = SteamCommunity.CConfirmation;
import TradeOffer = TradeOfferManager.TradeOffer;

let fs = require("fs");

export enum TwoFactorState{
    Locked      = 0,
    Disabled    = 1,
    Enabled     = 2,
    Finalized   = 3
}

/**
 *  Bot data interface
 */
export interface SteamBotData{

    username:               string;
    password:               string;
    pollDataDirectory:      string;

    /* Two factor auth datas */
    twoFactorState: TwoFactorState;
    twoFactorSharedSecret?: string;
    twoFactorRevocationCode?: string;
    twoFactorIdentitySecret?: string;

    /* Trade offer manager data */
    tradeOfferDomain?: string;
    tradeOfferPollInterval?: number;
    tradeOfferConfirmationPollInterval?: number;
}

export interface LoginSession {
    cookies:        any;
    sessionID:      any;
    steamguard:     any;
}

export enum LoginErrorType {
    AlreadyLoggedIn,
    MobileCodeRequired,
    MailCodeRequired,
    CaptchaRequired,
    SteamCommunityError,
    TradeOfferManagerError
}

export interface LoginError {
    type: LoginErrorType;
    error?: any;
}

export interface BotLoginOptions{
    captcha?:           string;
    authCode?:          string;
    twoFactorCode?:     string;
    steamguard?:        string;
}

export let SteamBotEvent = {
    DataModified: "DataModified",
    LoggedIn: "LoggedIn"
};

export interface TradeItem{
    assetid: string;
    appid: string;
    contextid: string;
    amount: number;
}

export interface TradeRequest{
    tradeUrl: string;
    botItems: TradeItem[];
    partnerItems: TradeItem[];
}

/**
 *
 */
export class SteamBot extends EventEmitter{

    private _botDatas:              SteamBotData;
    private _community:             SteamCommunity;
    private _tradeOfferManager:     TradeOfferManager;
    private _loginSession:          LoginSession;
    private _confirmationChecker:   boolean;

    constructor(datas: SteamBotData){
        super();

        this._botDatas = datas;
        this._community = new SteamCommunity();
        this._loginSession = null;
        this._confirmationChecker = false;
        this._tradeOfferManager = new TradeOfferManager(this.tradeOfferManagerOptions);

        this._tradeOfferManager.on('pollData', pollData => this.writePollData(pollData));

        if(fs.existsSync(this.pollDataFilePath)){
            this._tradeOfferManager.pollData = JSON.parse(fs.readFileSync(this.pollDataFilePath).toString());
        }
    }

    login(options?: BotLoginOptions) : Promise<void>{
        return new Promise<void>((resolve, reject) => {
            if(this._loginSession != null){
                reject(<LoginError>{type: LoginErrorType.AlreadyLoggedIn});
            }

            let loginOptions = <SteamCommunity.LoginOptions>{
                accountName:        this._botDatas.username,
                password:           this._botDatas.password,
                authCode:           options.authCode,
                captcha:            options.captcha,
                twoFactorCode:      options.twoFactorCode,
                steamguard:         options.steamguard
            };

            if(this._botDatas.twoFactorState == TwoFactorState.Finalized){
                loginOptions.twoFactorCode = SteamTotp.getAuthCode(this._botDatas.twoFactorSharedSecret);
            }

            this._community.login(loginOptions, (err: Error, sessionID: string, cookies: any, steamguard: string) => {
                if(err){

                    let loginError: LoginError;

                    if(err.message == "SteamGuardMobile"){
                        loginError = <LoginError>{type: LoginErrorType.MobileCodeRequired};
                    }
                    else if(err.message == "SteamGuard"){
                        loginError = <LoginError>{type: LoginErrorType.MailCodeRequired, error: err};
                    }
                    else if(err.message == "CAPTCHA"){
                        loginError = <LoginError>{type: LoginErrorType.CaptchaRequired};
                    }
                    else{
                        loginError = <LoginError>{type: LoginErrorType.SteamCommunityError, error: err};
                    }

                    reject(loginError);
                }
                else{
                    this._loginSession = <LoginSession>{
                        cookies: cookies, sessionID: sessionID, steamguard: steamguard
                    };

                    this._tradeOfferManager.setCookies(cookies, (err: Error) => {
                        if(err){
                            reject(<LoginError>{type: LoginErrorType.TradeOfferManagerError, error: err});
                        }
                        else{

                            this._loginSession = <LoginSession>{
                                cookies: cookies, sessionID: sessionID, steamguard: steamguard
                            };

                            this.emit(SteamBotEvent.LoggedIn);
                            resolve();
                        }
                    });
                }
            });

        });
    }

    logout() : Promise<void>{

        return new Promise<void>((resolve, reject) => {
            this._community.loggedIn((err: Error, loggedIn: boolean) => {
                if(err){
                    reject(err);
                }
                else if(!loggedIn){
                    reject(new Error("Not logged in"));
                }
                else{
                    this._loginSession = null;
                    this._community.setCookies(null);
                    this._tradeOfferManager.setCookies(null);
                    resolve();
                }
            });
        });

    }

    enableTotp() : Promise<void> {

        return new Promise<void>((resolve, reject) => {
            if(this._botDatas.twoFactorState == TwoFactorState.Locked){
                reject(new Error("totp is locked"));
            }
            else if(this._botDatas.twoFactorState == TwoFactorState.Finalized){
                reject(new Error("totp is already enabled and finalized"));
            }
            else if(this._loginSession == null){
                reject(new Error("not logged in"));
            }
            else{

                this._community.enableTwoFactor((err: any, response: SteamCommunity.EnableTwoFactorResponse) => {
                    if(err){
                        if(err.eresult == 2){
                            reject(new Error("no phone associated with this account"));
                        }
                        else if(err.eresult == 84) {
                            reject(new Error("rate limit exceeded, try again later"));
                        }
                        else{
                            reject(err);
                        }
                    }
                    else{
                        if(response.status != TradeOfferManager.EResult.OK){
                            reject(new Error("bad response status"));
                        }
                        else{
                            this._botDatas.twoFactorState           = TwoFactorState.Enabled;
                            this._botDatas.twoFactorSharedSecret    = response.shared_secret;
                            this._botDatas.twoFactorRevocationCode  = response.revocation_code;
                            this._botDatas.twoFactorIdentitySecret  = response.identity_secret;
                            this.printTotpResponse(response);
                            this.emit(SteamBotEvent.DataModified);
                            resolve();
                        }
                    }

                });
            }
        });



    }

    finalizeTotp(code: string) : Promise<void> {

        return new Promise<void>((resolve, reject) => {
            if(this._botDatas.twoFactorState == TwoFactorState.Locked){
                reject(new Error("totp is locked"));
            }
            else if(this._botDatas.twoFactorState == TwoFactorState.Finalized){
                reject(new Error("totp is already enabled and finalized"));
            }
            else if(this._botDatas.twoFactorState != TwoFactorState.Enabled){
                reject(new Error("you must enable totp before finalize it"));
            }
            else if(this._loginSession == null){
                reject(new Error("not logged in"));
            }
            else{
                let secret: string = this._botDatas.twoFactorSharedSecret;
                this._community.finalizeTwoFactor(secret, code, (err: Error) => {
                    if(err){
                        reject(new Error("steamCommunity.finalizeTwoFactor"));
                    }
                    else{
                        this._botDatas.twoFactorState = TwoFactorState.Finalized;
                        this.emit(SteamBotEvent.DataModified);
                        resolve();
                    }
                });
            }
        });

    };

    disableTotp()  : Promise<void> {

        return new Promise<void>((resolve, reject) => {
            if(this._botDatas.twoFactorState == TwoFactorState.Locked){
                reject(new Error("totp is locked"));
            }
            else if(this._botDatas.twoFactorState != TwoFactorState.Finalized){
                reject(new Error("totp is not enabled and finalized"));
            }
            else if(this._loginSession == null){
                reject(new Error("not logged in"));
            }
            else{
                this._community.disableTwoFactor(this._botDatas.twoFactorRevocationCode, (err: Error) => {
                    if(err){
                        reject(new Error("steamCommunity.disableTwoFactor"));
                    }
                    else{
                        this._botDatas.twoFactorState = TwoFactorState.Disabled;
                        this._botDatas.twoFactorSharedSecret    = "";
                        this._botDatas.twoFactorRevocationCode  = "";
                        this._botDatas.twoFactorIdentitySecret  = "";
                        this.emit(SteamBotEvent.DataModified);
                        resolve();
                    }
                });
            }
        });


    }

    startConfirmationChecker() : Promise<void> {

        return new Promise<void>((resolve, reject) => {
            if(this._confirmationChecker === true){
                reject(new Error("confirmation checker already running"));
            }
            else if(this._botDatas.twoFactorState != TwoFactorState.Finalized){
                reject(new Error("totp is not finalized"));
            }
            else if(this._loginSession == null){
                reject(new Error("not logged in"));
            }
            else{
                let pollInterval = this._botDatas.tradeOfferConfirmationPollInterval;
                let identitySecret = this._botDatas.twoFactorIdentitySecret;

                this._community.on("confKeyNeeded", (tag: SteamTotp.TagType, callback: (err: Error, time: number, key: string) => any) => {
                    let time = Math.floor(Date.now() / 1000);
                    let key = SteamTotp.getConfirmationKey(identitySecret, time, tag);
                    callback(null, time, key);
                });

                this._community.startConfirmationChecker(pollInterval, identitySecret);
                this._confirmationChecker = true;

                resolve();
            }
        });

    }

    stopConfirmationChecker() : Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if(this._confirmationChecker  === false){
                reject(new Error("confirmation checker not running"));
            }
            else{
                this._community.stopConfirmationChecker();
                this._confirmationChecker = false;
                resolve();
            }
        });
    }

    checkConfirmations(){
        this._community.checkConfirmations();
    }

    getConfirmations() : Promise<CConfirmation[]> {

        return new Promise<CConfirmation[]>((resolve, reject) => {
            let time = Math.floor(Date.now() / 1000);
            let secret = this._botDatas.twoFactorIdentitySecret;
            let key = SteamTotp.getConfirmationKey(secret, time, "conf");

            this._community.getConfirmations(time, key, (err: Error, confirmations: CConfirmation[]) => {
                if(err){
                    reject(err);
                }
                else{
                    resolve(confirmations);
                }
            });
        });


    }

    answerConfirmation(confirmation: CConfirmation, accept: boolean) : Promise<void> {

        return new Promise<void>((resolve, reject) => {
            let time = Math.floor(Date.now() / 1000);
            let secret = this._botDatas.twoFactorIdentitySecret;
            let key = SteamTotp.getConfirmationKey(secret, time, "details");

            confirmation.respond(time, key, accept, (err: Error) => {
                if(err){
                    reject(err);
                }
                else{
                    resolve();
                }
            });
        });

    }

    chatLogon(interval?: number, uiMode?: "web" | "mobile"){
        return new Promise<void>((resolve, reject) => {
            if(this._loginSession == null){
                reject(new Error("not logged in"));
            }
            else{
                this._community.chatLogon(interval, uiMode);
                resolve();
            }
        });
    }

    chatLogoff() : Promise<void>{
        return new Promise<void>((resolve, reject) => {
            if(this._loginSession == null){
                reject(new Error("not logged in"));
            }
            else{
                this._community.chatLogoff();
                resolve();
            }
        });
    }

    sendChatMessage(recipientId: SteamID, text: string, type?: "saytext" | "typing") : Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if(this._loginSession == null){
                reject(new Error("not logged in"));
            }
            else{
                this._community.chatMessage(recipientId, text, type);
                resolve();
            }
        });
    }


    createTradeOffer(tradeUrl: string): Promise<TradeOffer> {
        return new Promise<TradeOffer>((resolve, reject) => {
            if(this._loginSession == null){
                reject(new Error("not logged in"));
            }
            else{
                resolve(this._tradeOfferManager.createOffer(tradeUrl));
            }
        });
    }


    /** Typed events handling **/

    onLoggedIn(callback: () => any){
        this.on(SteamBotEvent.LoggedIn, callback);
    }

    onPollFailure(callback: (err: Error) => any){
        this._tradeOfferManager.on("pollFailure", callback);
    }

    onPollSuccess(callback: () => any){
        this._tradeOfferManager.on("pollSuccess", callback);
    }

    onPollData(callback: (pollData: any) => any){
        this._tradeOfferManager.on("pollData", callback);
    }

    onSessionExpired(callback: (err: Error) => any){
        this._community.on("sessionExpired", callback);
    }


    // Trading events
    onNewOffer(callback: (offer: TradeOfferManager.TradeOffer) => any){
        this._tradeOfferManager.on("newOffer", callback);
    }

    onSentOfferChanged(callback: (offer: TradeOfferManager.TradeOffer, oldState: TradeOfferManager.ETradeOfferState) => any){
        this._tradeOfferManager.on("sentOfferChanged", callback);
    }

    onSentOfferCanceled(callback: (offer: TradeOfferManager.TradeOffer, reason: string) => any){
        this._tradeOfferManager.on("sentOfferCanceled", callback);
    }

    onSentPendingOfferCanceled(callback: (offer: TradeOfferManager.TradeOffer) => any){
        this._tradeOfferManager.on("sentPendingOfferCanceled", callback);
    }

    onUnknownOfferSent(callback: (offer: TradeOfferManager.TradeOffer) => any){
        this._tradeOfferManager.on("unknownOfferSent", callback);
    }

    onReceivedOfferChanged(callback: (offer: TradeOfferManager.TradeOffer, oldState: TradeOfferManager.ETradeOfferState) => any){
        this._tradeOfferManager.on("receivedOfferChanged", callback);
    }

    // Chat events
    onChatLogonFailed(callback: (err: Error, fatal: boolean) => any){
        this._community.on("chatLogOnFailed", callback);
    }

    onChatLoggedOf(callback: () => any){
        this._community.on("chatLoggedOff", callback);
    }

    onChatLoggedOn(callback: () => any){
        this._community.on("chatLoggedOn", callback);
    }

    onChatPersonaState(callback: (steamID: SteamID, persona: SteamCommunity.Persona) => any){
        this._community.on("chatPersonaState", callback);
    }

    onChatMessage(callback: (sender: SteamID, text: string) => any){
        this._community.on("chatMessage", callback);
    }

    onChatTyping(callback: (sender: SteamID) => any){
        this._community.on("chatTyping", callback);
    }


    /** ********** **/
    private printTotpResponse(response: SteamCommunity.EnableTwoFactorResponse){
        console.log('#################');
        console.log('!! COPY THIS SOMEWHERE !!');
        console.log('TwoFactor ' + this._botDatas.username);
        console.log('shared_secret: ' + response.shared_secret);
        console.log('revocation_code: ' + response.revocation_code);
        console.log('identity_secret: ' + response.identity_secret);
        console.log('raw_response: ' + response);
        console.log('#################');
    }

    private get tradeOfferManagerOptions() : TradeOfferManager.Options{
        return <TradeOfferManager.Options>{
            domain: this._botDatas.tradeOfferDomain,
            language: "en",
            pollInterval: this._botDatas.tradeOfferPollInterval
        };
    }

    private get pollDataFilePath() : string{
        return this._botDatas.pollDataDirectory + "/" + this._botDatas.username + ".polldata.json";
    }

    private writePollData(pollData: any){
        fs.writeFile(this.pollDataFilePath, JSON.stringify(pollData));
    }


    /* *************** */
    get botDatas(): SteamBotData {
        return this._botDatas;
    }

    get confirmationChecker(): boolean {
        return this._confirmationChecker;
    }
}