// globals.d.ts
// 微信小程序全局类型声明（项目用 TS 但没装官方类型包，这里兜底）
// 后续如接入 miniprogram-api-typings，可移除本文件

declare const wx: any;
declare const getApp: any;
declare const getCurrentPages: any;

declare function App(options: any): any;
declare function Page(options: any): any;
declare function Component(options: any): any;
declare function Behavior(options: any): any;
declare function require(path: string): any;

declare namespace WechatMiniprogram {
  type Target = { dataset: Record<string, any> };
  type PickerChange = { detail: { value: string }; currentTarget: Target };
  type TapEvent = { currentTarget: Target };
  type Input = { detail: { value: string }; currentTarget: Target };
  type SwitchChange = { detail: { value: boolean }; currentTarget: Target };
  type LoginRes = { code: string };
  type Canvas = {
    width: number;
    height: number;
    getContext(type: string): any;
    createImage(): any;
  };
  namespace Page {
    type ICustomShareContent = {
      title?: string;
      path?: string;
      imageUrl?: string;
    };
    type ICustomTimelineContent = {
      title?: string;
      query?: string;
      imageUrl?: string;
    };
  }
  namespace General {
    type Callback = (...args: any[]) => void;
  }
}
