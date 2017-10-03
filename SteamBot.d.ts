/// <reference types="node" />
/// <reference types="steamcommunity" />
/// <reference types="steamid" />
/// <reference types="steam-tradeoffer-manager" />
import { EventEmitter } from "events";
import SteamID = require("steamid");
import SteamCommunity = require("steamcommunity");
import TradeOfferManager = require("steam-tradeoffer-manager");
import CConfirmation = SteamCommunity.CConfirmation;
import TradeOffer = TradeOfferManager.TradeOffer;
export declare enum TwoFactorState {
    Locked = 0,
    Disabled = 1,
    Enabled = 2,
    Finalized = 3,
}
export interface ISteamBotData {
    id?: number;
    username: string;
    password: string;
    pollDataDirectory: string;
    twoFactorState: TwoFactorState;
    twoFactorSharedSecret?: string;
    twoFactorRevocationCode?: string;
    twoFactorIdentitySecret?: string;
    tradeOfferDomain?: string;
    tradeOfferPollInterval?: number;
    tradeOfferConfirmationPollInterval?: number;
}
export interface LoginSession {
    cookies: any;
    sessionID: any;
    steamguard: any;
}
export declare enum LoginErrorType {
    AlreadyLoggedIn = 0,
    MobileCodeRequired = 1,
    MailCodeRequired = 2,
    CaptchaRequired = 3,
    SteamCommunityError = 4,
    TradeOfferManagerError = 5,
}
export declare class LoginError {
    type: LoginErrorType;
    error?: any;
    constructor(type: LoginErrorType, err?: any);
}
export interface BotLoginOptions {
    captcha?: string;
    authCode?: string;
    twoFactorCode?: string;
    steamguard?: string;
}
export declare let SteamBotEvent: {
    DataModified: string;
    LoggedIn: string;
};
export interface TradeItem {
    assetid: string;
    appid: string;
    contextid: string;
    amount: number;
}
export interface TradeRequest {
    tradeUrl: string;
    botItems: TradeItem[];
    partnerItems: TradeItem[];
}
/**
 *
 */
export declare class SteamBot extends EventEmitter {
    private _botDatas;
    private _community;
    private _tradeOfferManager;
    private _loginSession;
    private _confirmationChecker;
    constructor(datas: ISteamBotData);
    login(options?: BotLoginOptions): Promise<void>;
    logout(): Promise<void>;
    enableTotp(): Promise<void>;
    finalizeTotp(code: string): Promise<void>;
    disableTotp(): Promise<void>;
    startConfirmationChecker(): Promise<void>;
    stopConfirmationChecker(): Promise<void>;
    checkConfirmations(): void;
    getConfirmations(): Promise<CConfirmation[]>;
    answerConfirmation(confirmation: CConfirmation, accept: boolean): Promise<void>;
    chatLogon(interval?: number, uiMode?: "web" | "mobile"): Promise<void>;
    chatLogoff(): Promise<void>;
    sendChatMessage(recipientId: SteamID, text: string, type?: "saytext" | "typing"): Promise<void>;
    createTradeOffer(tradeUrl: string): Promise<TradeOffer>;
    /** Typed events handling **/
    onLoggedIn(callback: () => any): void;
    onPollFailure(callback: (err: Error) => any): void;
    onPollSuccess(callback: () => any): void;
    onPollData(callback: (pollData: any) => any): void;
    onSessionExpired(callback: (err: Error) => any): void;
    onNewOffer(callback: (offer: TradeOfferManager.TradeOffer) => any): void;
    onSentOfferChanged(callback: (offer: TradeOfferManager.TradeOffer, oldState: TradeOfferManager.ETradeOfferState) => any): void;
    onSentOfferCanceled(callback: (offer: TradeOfferManager.TradeOffer, reason: string) => any): void;
    onSentPendingOfferCanceled(callback: (offer: TradeOfferManager.TradeOffer) => any): void;
    onUnknownOfferSent(callback: (offer: TradeOfferManager.TradeOffer) => any): void;
    onReceivedOfferChanged(callback: (offer: TradeOfferManager.TradeOffer, oldState: TradeOfferManager.ETradeOfferState) => any): void;
    onChatLogonFailed(callback: (err: Error, fatal: boolean) => any): void;
    onChatLoggedOf(callback: () => any): void;
    onChatLoggedOn(callback: () => any): void;
    onChatPersonaState(callback: (steamID: SteamID, persona: SteamCommunity.Persona) => any): void;
    onChatMessage(callback: (sender: SteamID, text: string) => any): void;
    onChatTyping(callback: (sender: SteamID) => any): void;
    /** ********** **/
    private printTotpResponse(response);
    private readonly tradeOfferManagerOptions;
    private readonly pollDataFilePath;
    private writePollData(pollData);
    readonly botDatas: ISteamBotData;
    readonly confirmationChecker: boolean;
}
