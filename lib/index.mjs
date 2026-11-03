import z from '@deepseek-ai/schemastery';
import * as protocol from '@deepseek-ai/dsh-typert-protocol';
import {defineTool} from '@deepseek-ai/dsh-tools';
import {defaultDataDir} from './controller.mjs';
import {createHostPlugin} from './host.mjs';
export const name='workbench-suite';
export const inject=['tools','skills'];
export const Config=z.object({dataDir:z.string().default(defaultDataDir()),pythonPath:z.string().default('python'),preferredPort:z.natural().default(0),autoStart:z.boolean().default(false)});
export const {apply,WorkbenchService}=createHostPlugin(protocol,defineTool);
