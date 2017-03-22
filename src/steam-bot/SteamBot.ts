/**
 *
 */

import {EventEmitter}       from "events";

import fs                   = require("fs");

import SteamID              = require("steamid");
import SteamCommunity       = require("steamcommunity");
import SteamTotp            = require("steam-totp");
import TradeOfferManager    = require("steam-tradeoffer-manager");

export interface LoginSession {
    cookies:        any;
    sessionID:      any;
    steamguard:     any;
}

export enum TwoFactorState{
    Locked = 0,
    Disabled = 1,
    Enabled = 2,
    Finalized = 3
}

export interface TwoFactorSettings {
    state:                       TwoFactorState;
    sharedSecret?:               string;
    revocationCode?:             string;
    identitySecret?:             string;
}

export interface TradeOfferManagerSettings {
    domain:                         string;
    language?:                      string;
    pollInterval?:                  number;
    confirmationPollInterval?:      number; // keep it > 10,000 to avoid rate limits
}

export interface BotSettings {
    username:               string;
    password:               string;
    twoFactor:              TwoFactorSettings;
    trade:                  TradeOfferManagerSettings;
}

export enum LoginError {
    AlreadyLoggedIn,
    MobileCodeRequired,
    MailCodeRequired,
    CaptchaRequired,
    SteamCommunityError,
    TradeOfferManagerError
}

export interface BotLoginOptions{
    captcha?:           string;
    authCode?:          string;
    twoFactorCode?:     string;
    steamguard?:        string;
}

export class SteamBot extends EventEmitter{

    private _settings:              BotSettings;
    private _community:             SteamCommunity;
    private _tradeOfferManager:     TradeOfferManager;
    private _loginSession:          LoginSession;
    private _confirmationChecker:   boolean;

    constructor(settings: BotSettings){
        super();

        this._settings = settings;

        this._community = new SteamCommunity();
        this._tradeOfferManager = new TradeOfferManager(<TradeOfferManager.Options>{
            domain: settings.trade.domain,
            language: settings.trade.language,
            pollInterval: settings.trade.pollInterval
        });

        this._loginSession = null;
        this._confirmationChecker = false;

        this.readPollData();


        this._community.on("confKeyNeeded", (tag: SteamTotp.TagType, callback: (err: Error, time: number, key: string) => any) => {
            var time = Math.floor(Date.now() / 1000);
            var secret = this._settings.twoFactor.identitySecret;
            // only triggered when confirmation checker is running => <secret> is set at this point
            callback(null, time, SteamTotp.getConfirmationKey(secret, time, tag));
        });

        this._tradeOfferManager.on("pollData", (pollData: any) => {
            this.writePollData(pollData);
        });

    }

    private readPollData(){
        if(fs.existsSync(this.pollDataFilePath)){
            this._tradeOfferManager.pollData = JSON.parse(fs.readFileSync(this.pollDataFilePath).toString());
        }
    }

    private writePollData(pollData: any){
        fs.writeFile(this.pollDataFilePath, JSON.stringify(pollData));
    }

    get settings(): BotSettings {
        return this._settings;
    }

    get community(): SteamCommunity {
        return this._community;
    }

    get tradeOfferManager(): TradeOfferManager {
        return this._tradeOfferManager;
    }

    get loginSession(): LoginSession {
        return this._loginSession;
    }

    get confirmationChecker(): boolean {
        return this._confirmationChecker;
    }

    private get pollDataFilePath() : string{
        return "data/poll/" + this._settings.username + ".polldata.json";
    }


    private makeLoginOptions(botOptions: BotLoginOptions): SteamCommunity.LoginOptions {

        var loginOptions = <SteamCommunity.LoginOptions>{
            accountName: this._settings.username,
            password: this._settings.password,
            authCode: botOptions.authCode,
            captcha: botOptions.captcha,
            twoFactorCode: botOptions.twoFactorCode,
            steamguard: botOptions.steamguard
        };

        console.log("AUTH CODE : " + botOptions.authCode);

        if(this._settings.twoFactor.state == TwoFactorState.Finalized){
            loginOptions.twoFactorCode = SteamTotp.getAuthCode(this._settings.twoFactor.sharedSecret);
        }

        return loginOptions;
    }

    login(options: BotLoginOptions, callback: (errType?: LoginError, err?: Error) => any){

        if(this.loginSession != null){
            callback(LoginError.AlreadyLoggedIn);
        }

        var loginOptions = this.makeLoginOptions(options);

        this._community.login(loginOptions, (err: Error, sessionID: string, cookies: any, steamguard: string) => {
            if(err){

                if(err.message == "SteamGuardMobile"){
                    callback(LoginError.MobileCodeRequired);
                }
                else if(err.message == "SteamGuard"){
                    callback(LoginError.MailCodeRequired);
                }
                else if(err.message == "CAPTCHA"){
                    callback(LoginError.CaptchaRequired);
                }
                else{
                    callback(LoginError.SteamCommunityError, err);
                }
            }
            else{
                this._loginSession = <LoginSession>{
                    cookies: cookies,
                    sessionID: sessionID,
                    steamguard: steamguard
                };

                this._tradeOfferManager.setCookies(cookies, (err: Error) => {
                    if(err){
                        callback(LoginError.TradeOfferManagerError, err);
                    }
                    else{

                        this._loginSession = <LoginSession>{
                            cookies: cookies,
                            sessionID: sessionID,
                            steamguard: steamguard
                        };

                        callback();
                    }
                });

            }
        });

    }

    enableTop(callback: (err?: Error) => any){
        if(this._settings.twoFactor.state == TwoFactorState.Locked){
            console.log(1);
            callback(new Error("totp is locked"));
        }
        else if(this._settings.twoFactor.state == TwoFactorState.Finalized){
            console.log(2);
            callback(new Error("totp is already enabled and finalized"));
        }
        else if(this._loginSession == null){
            console.log(3);
            callback(new Error("not logged in"));
        }
        else{

            this._community.enableTwoFactor((err: any, response: SteamCommunity.EnableTwoFactorResponse) => {
                if(err){
                    if(err.eresult == 2){
                        callback(new Error("no phone associated with this account"));
                    }
                    else if(err.eresult == 84) {
                        callback(new Error("rate limit exceeded, try again later"));
                    }
                    else{
                        callback(err);
                    }
                }
                else{
                    if(response.status != TradeOfferManager.EResult.OK){
                        console.log(7);
                        callback(new Error("bad response status"));
                    }
                    else{

                        this._settings.twoFactor.state = TwoFactorState.Enabled;
                        this._settings.twoFactor.sharedSecret = response.shared_secret;
                        this._settings.twoFactor.revocationCode = response.revocation_code;
                        this._settings.twoFactor.identitySecret = response.identity_secret;
                        this.printTotpResponse(response);
                        console.log(0);
                        callback();
                    }
                }

            });

        }
    }

    private printTotpResponse(response: SteamCommunity.EnableTwoFactorResponse){
        console.log('#################');
        console.log('!! COPY THIS SOMEWHERE !!');
        console.log('TwoFactor ' + this._settings.username);
        console.log('shared_secret: ' + response.shared_secret);
        console.log('revocation_code: ' + response.revocation_code);
        console.log('identity_secret: ' + response.identity_secret);
        console.log('raw_response: ' + response);
        console.log('#################');
    }

    finalizeTotp(code: string, callback: (err?: Error) => void) {
        if(this._settings.twoFactor.state == TwoFactorState.Locked){
            callback(new Error("totp is locked"));
        }
        else if(this._settings.twoFactor.state == TwoFactorState.Finalized){
            callback(new Error("totp is already enabled and finalized"));
        }
        else if(this._settings.twoFactor.state != TwoFactorState.Enabled){
            callback(new Error("you must enable totp before finalize it"));
        }
        else if(this._loginSession == null){
            callback(new Error("not logged in"));
        }
        else{
            var secret: string = this._settings.twoFactor.sharedSecret;
            this._community.finalizeTwoFactor(secret, code, (err: Error) => {
                if(err){
                    callback(new Error("steamCommunity.finalizeTwoFactor"));
                }
                else{
                    this._settings.twoFactor.state = TwoFactorState.Finalized;
                    callback();
                }
            });
        }

    };

    disableTotp(callback: (err: Error) => any){
        if(this._settings.twoFactor.state == TwoFactorState.Locked){
            callback(new Error("totp is locked"));
        }
        else if(this._settings.twoFactor.state != TwoFactorState.Finalized){
            callback(new Error("totp is not enabled and finalized"));
        }
        else if(this._loginSession == null){
            callback(new Error("not logged in"));
        }
        else{
            this._community.disableTwoFactor(this._settings.twoFactor.revocationCode, (err: Error) => {
                if(err){
                    callback(new Error("steamCommunity.disableTwoFactor"));
                }
                else{
                    this._settings.twoFactor = <TwoFactorSettings>{ state: TwoFactorState.Disabled };
                    callback(null);
                }
            });
        }
    }

    startConfirmationChecker(callback: (err: Error) => any){
        if(this._confirmationChecker === true){
            callback(new Error("confirmation checker already running"));
        }
        else if(this._settings.twoFactor.state != TwoFactorState.Finalized){
            callback(new Error("totp is not finalized"));
        }
        else if(this._loginSession == null){
            callback(new Error("not logged in"));
        }
        else{
            var pollInterval = this._settings.trade.confirmationPollInterval;
            var identitySecret = this._settings.twoFactor.identitySecret;

            this._community.startConfirmationChecker(pollInterval, identitySecret);
            this._confirmationChecker = true;

            callback(null);
        }
    }

    stopConfirmationChecker(callback: (err: Error) => any){
        if(this._confirmationChecker  === false){
            callback(new Error("confirmation checker not running"));
        }
        else{
            this._community.stopConfirmationChecker();
            callback(null);
        }
    }

    checkConfirmations(){
        this._community.checkConfirmations();
    }

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

    onPollFailure(callback: (err: Error) => any){
        this._tradeOfferManager.on("pollFailure", callback);
    }

    onPollSuccess(callback: () => any){
        this._tradeOfferManager.on("pollSuccess", callback);
    }

    onPollData(callback: (pollData: any) => any){
        this._tradeOfferManager.on("pollData", callback);
    }

}

