import { Cloud } from '@rotcare/cloud';
import * as fs from 'fs';
import { promisify } from 'util';
import * as path from 'path';
import { Project } from '@rotcare/project';
import { buildFrontend} from '@rotcare/project-esbuild';

const readFile = promisify(fs.readFile);
const lstat = promisify(fs.lstat);

export async function deployFrontend(cloud: Cloud, project: Project) {
    const result = await buildFrontend(project);
    const htmlPath = path.join(project.projectDir, 'index.html');
    project.subscribePath(htmlPath);
    const html = await readFileWithCache(htmlPath);
    await cloud.objectStorage.putObject('/', html);
    await cloud.objectStorage.putObject('/frontend.js', result.outputFiles![0].text);
}

const fileCache = new Map<string, [number, string]>();

async function readFileWithCache(filePath: string) {
    const mtimeMs = (await lstat(filePath)).mtimeMs;
    if (fileCache.has(filePath)) {
        const [cachedMtimeMs, content] = fileCache.get(filePath)!;
        if (mtimeMs === cachedMtimeMs) {
            return content;
        }
    }
    const content = (await readFile(filePath)).toString();
    fileCache.set(filePath, [mtimeMs, content]);
    return content;
}
