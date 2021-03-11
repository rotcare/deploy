import { Command } from 'commander';
import { buildModel } from './buildModel';
import { Project } from './Project';
import { watch } from './watch';

export async function main() {
    const program = new Command('stableinf');
    program.command('watch [projectDir]').action(watch);
    program
        .command('model <projectDir> <qualifiedName>')
        .action(async (projectDir, qualifiedName) => {
            console.log((await buildModel(new Project(projectDir), qualifiedName)).code);
        });
    return program.parse(process.argv);
}
