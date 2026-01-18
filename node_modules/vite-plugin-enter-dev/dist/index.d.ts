import { Plugin } from 'vite';

interface DevOptions {
    /**
     * 是否注入消息监听器脚本（默认：true）
     */
    injectMessageListener?: boolean;
}
declare function enterDevPlugin(options?: DevOptions): Plugin[];
interface ProdOptions {
    /**
     * 是否注入 Google Fonts（默认：true）
     */
    injectGoogleFonts?: boolean;
    /**
     * Google Fonts 链接（可自定义）
     */
    googleFontsUrl?: string;
}
declare function enterProdPlugin(options?: ProdOptions): Plugin[];

export { enterDevPlugin, enterProdPlugin };
