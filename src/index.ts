import { Command } from 'commander';
import { buildModel, esbuildPlugin } from './buildModel/buildModel';
import { Project } from './Project';
import { watch } from './watch';
import * as path from 'path';
import * as childProcess from 'child_process';
import * as esbuild from 'esbuild';

// deploy triggered from unit test
export function register() {
    const builtinModule = require('module');
    const Module = module.constructor.length > 1 ? module.constructor : builtinModule;
    const oldResolveFilename = Module._resolveFilename;
    Module._resolveFilename = function (
        request: any,
        parentModule: any,
        isMain: any,
        options: any,
    ) {
        if (request.startsWith('@motherboard/')) {
            return `${request}.ts`;
        }
        return oldResolveFilename.call(this, request, parentModule, isMain, options);
    };

    const projectDir = process.cwd();
    const projectSrcDir = path.join(projectDir, 'src');
    let requireExtensions: NodeJS.RequireExtensions;
    try {
        requireExtensions = require.extensions;
    } catch (e) {
        console.error('Could not register extension');
        throw e;
    }

    const origJsHandler = requireExtensions['.js'];
    const cache: Record<string, string> = {};

    const registerExtension = (ext: string) => {
        const origHandler = requireExtensions[ext] || origJsHandler;
        requireExtensions[ext] = function (module, filename) {
            if (filename.startsWith('@motherboard/')) {
                const qualifiedName = filename.replace('.ts', '').substr('@motherboard/'.length);
                if (!cache[qualifiedName]) {
                    const data = JSON.parse(
                        childProcess
                            .execSync(`rotcare build --json ${projectDir} ${qualifiedName}`)
                            .toString(),
                    );
                    Object.assign(cache, data);
                }
                return (module as any)._compile(cache[qualifiedName], filename);
            }
            const relPath = path.relative(projectSrcDir, filename);
            if (relPath[0] === '.') {
                return origHandler(module, filename);
            }
            const dotPos = relPath.indexOf('.');
            const qualifiedName = relPath.substr(0, dotPos);
            return (module as any)._compile(`require('@motherboard/${qualifiedName}')`, filename);
        };
    };

    registerExtension('.ts');
    registerExtension('.tsx');
}

// deploy triggered from cli
export async function main() {
    const program = new Command('rotcare');
    program.command('watch [projectDir]').action(watch);
    program
        .command('build <projectDir> <qualifiedName>')
        .option('--json')
        .action(async (projectDir, qualifiedName, options) => {
            const project = new Project(projectDir);
            project.incompleteModels.add(qualifiedName);
            const qualifiedNames: string[] = [];
            while (project.incompleteModels.size > 0) {
                const toBuild = [...project.incompleteModels];
                for (const qualifiedName of toBuild) {
                    if (!qualifiedNames.includes(qualifiedName)) {
                        qualifiedNames.push(qualifiedName);
                    }
                    buildModel({ project, qualifiedName });
                }
            }
            const result = await esbuild.build({
                sourcemap: 'inline',
                keepNames: true,
                bundle: false,
                entryPoints: qualifiedNames.map((qualifiedName) => `@motherboard/${qualifiedName}`),
                platform: 'node',
                format: 'cjs',
                write: false,
                outdir: '/tmp',
                absWorkingDir: project.projectDir,
                plugins: [esbuildPlugin({ project })],
            });
            if (result.warnings.length > 0) {
                for (const warning of result.warnings) {
                    console.error(warning);
                }
                process.exit(1);
            }
            const data: Record<string, string> = {};
            for (const [i, outputFile] of result.outputFiles.entries()) {
                data[qualifiedNames[i]] = outputFile.text;
            }
            if (options.json) {
                console.log(JSON.stringify(data));
            } else {
                console.log(data[qualifiedName]);
            }
        });
    return program.parse(process.argv);
}
