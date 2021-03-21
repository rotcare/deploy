import { Cloud } from '@rotcare/cloud';
import { Project } from '@rotcare/project';
import { buildBackend } from '@rotcare/project-esbuild';
import * as path from 'path';
import * as fs from 'fs';
import * as vm from 'vm';

export async function deployBackend(cloud: Cloud, project: Project) {
    if (!fs.existsSync(path.join(project.projectDir, 'backend.ts'))) {
        return;
    }
    const result = await buildBackend(project);
    const bundledCode = result.outputFiles![0].text;
    await cloud.serverless.createSharedLayer(bundledCode);
    const functionNames = evalToListFunctionNames(bundledCode);
    for (const functionName of functionNames) {
        await cloud.serverless.createFunction(functionName);
        await cloud.apiGateway.createRoute({
            path: `/${functionName}`,
            httpMethod: 'POST',
            functionName,
        });
    }
    await cloud.apiGateway.reload({
        projectPackageName: project.projectPackageName,
    });
    if (functionNames.includes('migrate')) {
        await cloud.serverless.invokeFunction('migrate');
    }
}

function evalToListFunctionNames(bundledCode: string) {
    const exports: any = {};
    vm.runInNewContext(
        bundledCode,
        vm.createContext({ exports, require: global.require }),
    );
    return Object.keys(exports.httpRpcServers || {});
}