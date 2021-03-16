import { Command } from 'commander';
import { buildModel } from './buildModel/buildModel';
import { Project } from './Project';
import { watch } from './watch';

export async function main() {
    const program = new Command('rotcare');
    program.command('watch [projectDir]').action(watch);
    program
        .command('model <projectDir> <qualifiedName>')
        .action(async (projectDir, qualifiedName) => {
            console.log((await buildModel(new Project(projectDir), qualifiedName)).code);
        });
    return program.parse(process.argv);
}
