Input::
//// [/lib/lib.d.ts]


//// [/lib/lib.es2020.full.d.ts]
/// <reference no-default-lib="true"/>
interface Boolean {}
interface Function {}
interface CallableFunction {}
interface NewableFunction {}
interface IArguments {}
interface Number { toExponential: any; }
interface Object {}
interface RegExp {}
interface String { charAt: any; }
interface Array<T> { length: number; [n: number]: T; }

//// [/src/src-dogs/dog.ts]
import { DogConfig } from 'src-types';
import { DOG_CONFIG } from './dogconfig.js';

export abstract class Dog {

    public static getCapabilities(): DogConfig {
        return DOG_CONFIG;
    }
}


//// [/src/src-dogs/dogconfig.ts]
import { DogConfig } from 'src-types';

export const DOG_CONFIG: DogConfig = {
    name: 'Default dog',
};


//// [/src/src-dogs/index.ts]
export * from 'src-types';
export * from './lassie/lassiedog.js';


//// [/src/src-dogs/lassie/lassieconfig.ts]
import { DogConfig } from 'src-types';

export const LASSIE_CONFIG: DogConfig = { name: 'Lassie' };


//// [/src/src-dogs/lassie/lassiedog.ts]
import { Dog } from '../dog.js';
import { LASSIE_CONFIG } from './lassieconfig.js';

export class LassieDog extends Dog {
    protected static getDogConfig = () => LASSIE_CONFIG;
}


//// [/src/src-dogs/node_modules] symlink(/src)
//// [/src/src-dogs/package.json]
{
    "type": "module",
    "exports": "./index.js"
}

//// [/src/src-dogs/tsconfig.json]
{
    "extends": "../tsconfig-base.json",
    "compilerOptions": {
        "composite": true
    },
    "references": [
        { "path": "../src-types" }
    ],
    "include": [
        "**/*"
    ]
}

//// [/src/src-types/dogconfig.ts]
export interface DogConfig {
    name: string;
}

//// [/src/src-types/index.ts]
export * from './dogconfig.js';

//// [/src/src-types/node_modules] symlink(/src)
//// [/src/src-types/package.json]
{
    "type": "module",
    "exports": "./index.js"
}

//// [/src/src-types/tsconfig.json]
{
    "extends": "../tsconfig-base.json",
    "compilerOptions": {
        "composite": true
    },
    "include": [
        "**/*"
    ]
}

//// [/src/tsconfig-base.json]
{
    "compilerOptions": {
        "declaration": true,
        "module": "node12"
    }
}



Output::
/lib/tsc -b src/src-types src/src-dogs --verbose
[[90m12:00:00 AM[0m] Projects in this build: 
    * src/src-types/tsconfig.json
    * src/src-dogs/tsconfig.json

[[90m12:00:00 AM[0m] Project 'src/src-types/tsconfig.json' is out of date because output file 'src/src-types/dogconfig.js' does not exist

[[90m12:00:00 AM[0m] Building project '/src/src-types/tsconfig.json'...

[[90m12:00:00 AM[0m] Project 'src/src-dogs/tsconfig.json' is out of date because output file 'src/src-dogs/dog.js' does not exist

[[90m12:00:00 AM[0m] Building project '/src/src-dogs/tsconfig.json'...

exitCode:: ExitStatus.Success


//// [/src/src-dogs/dog.d.ts]
import { DogConfig } from 'src-types';
export declare abstract class Dog {
    static getCapabilities(): DogConfig;
}


//// [/src/src-dogs/dog.js]
import { DOG_CONFIG } from './dogconfig.js';
export class Dog {
    static getCapabilities() {
        return DOG_CONFIG;
    }
}


//// [/src/src-dogs/dogconfig.d.ts]
import { DogConfig } from 'src-types';
export declare const DOG_CONFIG: DogConfig;


//// [/src/src-dogs/dogconfig.js]
export const DOG_CONFIG = {
    name: 'Default dog',
};


//// [/src/src-dogs/index.d.ts]
export * from 'src-types';
export * from './lassie/lassiedog.js';


//// [/src/src-dogs/index.js]
export * from 'src-types';
export * from './lassie/lassiedog.js';


//// [/src/src-dogs/lassie/lassieconfig.d.ts]
import { DogConfig } from 'src-types';
export declare const LASSIE_CONFIG: DogConfig;


//// [/src/src-dogs/lassie/lassieconfig.js]
export const LASSIE_CONFIG = { name: 'Lassie' };


//// [/src/src-dogs/lassie/lassiedog.d.ts]
import { Dog } from '../dog.js';
export declare class LassieDog extends Dog {
    protected static getDogConfig: () => import("../index.js").DogConfig;
}


//// [/src/src-dogs/lassie/lassiedog.js]
import { Dog } from '../dog.js';
import { LASSIE_CONFIG } from './lassieconfig.js';
export class LassieDog extends Dog {
}
LassieDog.getDogConfig = () => LASSIE_CONFIG;


//// [/src/src-dogs/tsconfig.tsbuildinfo]
{"program":{"fileNames":["../../lib/lib.es2020.full.d.ts","../src-types/dogconfig.d.ts","../src-types/index.d.ts","./dogconfig.ts","./dog.ts","./lassie/lassieconfig.ts","./lassie/lassiedog.ts","./index.ts"],"fileInfos":[{"version":"-7698705165-/// <reference no-default-lib=\"true\"/>\ninterface Boolean {}\ninterface Function {}\ninterface CallableFunction {}\ninterface NewableFunction {}\ninterface IArguments {}\ninterface Number { toExponential: any; }\ninterface Object {}\ninterface RegExp {}\ninterface String { charAt: any; }\ninterface Array<T> { length: number; [n: number]: T; }","affectsGlobalScope":true,"impliedFormat":1},{"version":"-2632060142-export interface DogConfig {\r\n    name: string;\r\n}\r\n","impliedFormat":99},{"version":"-5608794531-export * from './dogconfig.js';\r\n","impliedFormat":99},{"version":"1966273863-import { DogConfig } from 'src-types';\n\nexport const DOG_CONFIG: DogConfig = {\n    name: 'Default dog',\n};\n","impliedFormat":99},{"version":"6091345804-import { DogConfig } from 'src-types';\nimport { DOG_CONFIG } from './dogconfig.js';\n\nexport abstract class Dog {\n\n    public static getCapabilities(): DogConfig {\n        return DOG_CONFIG;\n    }\n}\n","impliedFormat":99},{"version":"4440579024-import { DogConfig } from 'src-types';\n\nexport const LASSIE_CONFIG: DogConfig = { name: 'Lassie' };\n","impliedFormat":99},{"version":"-32303727812-import { Dog } from '../dog.js';\nimport { LASSIE_CONFIG } from './lassieconfig.js';\n\nexport class LassieDog extends Dog {\n    protected static getDogConfig = () => LASSIE_CONFIG;\n}\n","impliedFormat":99},{"version":"-15974991320-export * from 'src-types';\nexport * from './lassie/lassiedog.js';\n","impliedFormat":99}],"options":{"composite":true,"declaration":true,"module":100},"fileIdsList":[[3,4],[3],[3,7],[5,6],[2]],"referencedMap":[[5,1],[4,2],[8,3],[6,2],[7,4],[3,5]],"exportedModulesMap":[[5,1],[4,2],[8,3],[6,2],[7,4],[3,5]],"semanticDiagnosticsPerFile":[1,5,4,8,6,7,2,3]},"version":"FakeTSVersion"}

//// [/src/src-dogs/tsconfig.tsbuildinfo.readable.baseline.txt]
{
  "program": {
    "fileNames": [
      "../../lib/lib.es2020.full.d.ts",
      "../src-types/dogconfig.d.ts",
      "../src-types/index.d.ts",
      "./dogconfig.ts",
      "./dog.ts",
      "./lassie/lassieconfig.ts",
      "./lassie/lassiedog.ts",
      "./index.ts"
    ],
    "fileNamesList": [
      [
        "../src-types/index.d.ts",
        "./dogconfig.ts"
      ],
      [
        "../src-types/index.d.ts"
      ],
      [
        "../src-types/index.d.ts",
        "./lassie/lassiedog.ts"
      ],
      [
        "./dog.ts",
        "./lassie/lassieconfig.ts"
      ],
      [
        "../src-types/dogconfig.d.ts"
      ]
    ],
    "fileInfos": {
      "../../lib/lib.es2020.full.d.ts": {
        "version": "-7698705165-/// <reference no-default-lib=\"true\"/>\ninterface Boolean {}\ninterface Function {}\ninterface CallableFunction {}\ninterface NewableFunction {}\ninterface IArguments {}\ninterface Number { toExponential: any; }\ninterface Object {}\ninterface RegExp {}\ninterface String { charAt: any; }\ninterface Array<T> { length: number; [n: number]: T; }",
        "signature": "-7698705165-/// <reference no-default-lib=\"true\"/>\ninterface Boolean {}\ninterface Function {}\ninterface CallableFunction {}\ninterface NewableFunction {}\ninterface IArguments {}\ninterface Number { toExponential: any; }\ninterface Object {}\ninterface RegExp {}\ninterface String { charAt: any; }\ninterface Array<T> { length: number; [n: number]: T; }",
        "affectsGlobalScope": true,
        "impliedFormat": 1
      },
      "../src-types/dogconfig.d.ts": {
        "version": "-2632060142-export interface DogConfig {\r\n    name: string;\r\n}\r\n",
        "signature": "-2632060142-export interface DogConfig {\r\n    name: string;\r\n}\r\n",
        "impliedFormat": 99
      },
      "../src-types/index.d.ts": {
        "version": "-5608794531-export * from './dogconfig.js';\r\n",
        "signature": "-5608794531-export * from './dogconfig.js';\r\n",
        "impliedFormat": 99
      },
      "./dogconfig.ts": {
        "version": "1966273863-import { DogConfig } from 'src-types';\n\nexport const DOG_CONFIG: DogConfig = {\n    name: 'Default dog',\n};\n",
        "signature": "1966273863-import { DogConfig } from 'src-types';\n\nexport const DOG_CONFIG: DogConfig = {\n    name: 'Default dog',\n};\n",
        "impliedFormat": 99
      },
      "./dog.ts": {
        "version": "6091345804-import { DogConfig } from 'src-types';\nimport { DOG_CONFIG } from './dogconfig.js';\n\nexport abstract class Dog {\n\n    public static getCapabilities(): DogConfig {\n        return DOG_CONFIG;\n    }\n}\n",
        "signature": "6091345804-import { DogConfig } from 'src-types';\nimport { DOG_CONFIG } from './dogconfig.js';\n\nexport abstract class Dog {\n\n    public static getCapabilities(): DogConfig {\n        return DOG_CONFIG;\n    }\n}\n",
        "impliedFormat": 99
      },
      "./lassie/lassieconfig.ts": {
        "version": "4440579024-import { DogConfig } from 'src-types';\n\nexport const LASSIE_CONFIG: DogConfig = { name: 'Lassie' };\n",
        "signature": "4440579024-import { DogConfig } from 'src-types';\n\nexport const LASSIE_CONFIG: DogConfig = { name: 'Lassie' };\n",
        "impliedFormat": 99
      },
      "./lassie/lassiedog.ts": {
        "version": "-32303727812-import { Dog } from '../dog.js';\nimport { LASSIE_CONFIG } from './lassieconfig.js';\n\nexport class LassieDog extends Dog {\n    protected static getDogConfig = () => LASSIE_CONFIG;\n}\n",
        "signature": "-32303727812-import { Dog } from '../dog.js';\nimport { LASSIE_CONFIG } from './lassieconfig.js';\n\nexport class LassieDog extends Dog {\n    protected static getDogConfig = () => LASSIE_CONFIG;\n}\n",
        "impliedFormat": 99
      },
      "./index.ts": {
        "version": "-15974991320-export * from 'src-types';\nexport * from './lassie/lassiedog.js';\n",
        "signature": "-15974991320-export * from 'src-types';\nexport * from './lassie/lassiedog.js';\n",
        "impliedFormat": 99
      }
    },
    "options": {
      "composite": true,
      "declaration": true,
      "module": 100
    },
    "referencedMap": {
      "./dog.ts": [
        "../src-types/index.d.ts",
        "./dogconfig.ts"
      ],
      "./dogconfig.ts": [
        "../src-types/index.d.ts"
      ],
      "./index.ts": [
        "../src-types/index.d.ts",
        "./lassie/lassiedog.ts"
      ],
      "./lassie/lassieconfig.ts": [
        "../src-types/index.d.ts"
      ],
      "./lassie/lassiedog.ts": [
        "./dog.ts",
        "./lassie/lassieconfig.ts"
      ],
      "../src-types/index.d.ts": [
        "../src-types/dogconfig.d.ts"
      ]
    },
    "exportedModulesMap": {
      "./dog.ts": [
        "../src-types/index.d.ts",
        "./dogconfig.ts"
      ],
      "./dogconfig.ts": [
        "../src-types/index.d.ts"
      ],
      "./index.ts": [
        "../src-types/index.d.ts",
        "./lassie/lassiedog.ts"
      ],
      "./lassie/lassieconfig.ts": [
        "../src-types/index.d.ts"
      ],
      "./lassie/lassiedog.ts": [
        "./dog.ts",
        "./lassie/lassieconfig.ts"
      ],
      "../src-types/index.d.ts": [
        "../src-types/dogconfig.d.ts"
      ]
    },
    "semanticDiagnosticsPerFile": [
      "../../lib/lib.es2020.full.d.ts",
      "./dog.ts",
      "./dogconfig.ts",
      "./index.ts",
      "./lassie/lassieconfig.ts",
      "./lassie/lassiedog.ts",
      "../src-types/dogconfig.d.ts",
      "../src-types/index.d.ts"
    ]
  },
  "version": "FakeTSVersion",
  "size": 2019
}

//// [/src/src-types/dogconfig.d.ts]
export interface DogConfig {
    name: string;
}


//// [/src/src-types/dogconfig.js]
export {};


//// [/src/src-types/index.d.ts]
export * from './dogconfig.js';


//// [/src/src-types/index.js]
export * from './dogconfig.js';


//// [/src/src-types/tsconfig.tsbuildinfo]
{"program":{"fileNames":["../../lib/lib.es2020.full.d.ts","./dogconfig.ts","./index.ts"],"fileInfos":[{"version":"-7698705165-/// <reference no-default-lib=\"true\"/>\ninterface Boolean {}\ninterface Function {}\ninterface CallableFunction {}\ninterface NewableFunction {}\ninterface IArguments {}\ninterface Number { toExponential: any; }\ninterface Object {}\ninterface RegExp {}\ninterface String { charAt: any; }\ninterface Array<T> { length: number; [n: number]: T; }","affectsGlobalScope":true,"impliedFormat":1},{"version":"-5575793279-export interface DogConfig {\n    name: string;\n}","impliedFormat":99},{"version":"-6189272282-export * from './dogconfig.js';","impliedFormat":99}],"options":{"composite":true,"declaration":true,"module":100},"fileIdsList":[[2]],"referencedMap":[[3,1]],"exportedModulesMap":[[3,1]],"semanticDiagnosticsPerFile":[1,2,3]},"version":"FakeTSVersion"}

//// [/src/src-types/tsconfig.tsbuildinfo.readable.baseline.txt]
{
  "program": {
    "fileNames": [
      "../../lib/lib.es2020.full.d.ts",
      "./dogconfig.ts",
      "./index.ts"
    ],
    "fileNamesList": [
      [
        "./dogconfig.ts"
      ]
    ],
    "fileInfos": {
      "../../lib/lib.es2020.full.d.ts": {
        "version": "-7698705165-/// <reference no-default-lib=\"true\"/>\ninterface Boolean {}\ninterface Function {}\ninterface CallableFunction {}\ninterface NewableFunction {}\ninterface IArguments {}\ninterface Number { toExponential: any; }\ninterface Object {}\ninterface RegExp {}\ninterface String { charAt: any; }\ninterface Array<T> { length: number; [n: number]: T; }",
        "signature": "-7698705165-/// <reference no-default-lib=\"true\"/>\ninterface Boolean {}\ninterface Function {}\ninterface CallableFunction {}\ninterface NewableFunction {}\ninterface IArguments {}\ninterface Number { toExponential: any; }\ninterface Object {}\ninterface RegExp {}\ninterface String { charAt: any; }\ninterface Array<T> { length: number; [n: number]: T; }",
        "affectsGlobalScope": true,
        "impliedFormat": 1
      },
      "./dogconfig.ts": {
        "version": "-5575793279-export interface DogConfig {\n    name: string;\n}",
        "signature": "-5575793279-export interface DogConfig {\n    name: string;\n}",
        "impliedFormat": 99
      },
      "./index.ts": {
        "version": "-6189272282-export * from './dogconfig.js';",
        "signature": "-6189272282-export * from './dogconfig.js';",
        "impliedFormat": 99
      }
    },
    "options": {
      "composite": true,
      "declaration": true,
      "module": 100
    },
    "referencedMap": {
      "./index.ts": [
        "./dogconfig.ts"
      ]
    },
    "exportedModulesMap": {
      "./index.ts": [
        "./dogconfig.ts"
      ]
    },
    "semanticDiagnosticsPerFile": [
      "../../lib/lib.es2020.full.d.ts",
      "./dogconfig.ts",
      "./index.ts"
    ]
  },
  "version": "FakeTSVersion",
  "size": 891
}

