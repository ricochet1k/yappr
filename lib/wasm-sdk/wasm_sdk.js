import * as wasm from "./wasm_sdk_bg.wasm";
export * from "./wasm_sdk_bg.js";
import { __wbg_set_wasm } from "./wasm_sdk_bg.js";
__wbg_set_wasm(wasm);
wasm.__wbindgen_start();
