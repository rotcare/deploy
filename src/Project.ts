import * as path from 'path';
import * as chokidar from 'chokidar';

export class Project {
    public readonly packages: { path: string; name: string }[] = [];
    private readonly knownPackageNames = new Set<string>();
    public readonly projectPackageName: string;
    public readonly projectDir: string;
    public subscribePath = (filePath: string): void => {};
    public onChange: (filePath?: string) => void;

    constructor(relProjectDir: string) {
        this.projectDir = path.join(process.cwd(), relProjectDir || '.');
        let packageJson: any;
        try {
            packageJson = require(`${this.projectDir}/package.json`);
        } catch (e) {
            throw e;
        }
        this.projectPackageName = packageJson.name;
        const projectType = packageJson.rotcare?.project || 'solo';
        if (projectType === 'composite') {
            for (const pkg of Object.keys(packageJson.dependencies)) {
                try {
                    this.packages.push({
                        path: path.dirname(require.resolve(`${pkg}/package.json`)),
                        name: pkg,
                    });
                } catch(e) {
                    throw e;
                }
            }
        } else {
            this.packages.push({ path: this.projectDir, name: this.projectPackageName });
        }
    }

    public startWatcher(onChange: (filePath?: string) => void) {
        this.onChange = onChange;
        const watcher = new chokidar.FSWatcher();
        watcher.on('all', (eventName, filePath) => onChange(filePath));
        this.subscribePath = watcher.add.bind(watcher);
        onChange(undefined);
    }

    public subscribePackage(packageName: string) {
        if (this.knownPackageNames.has(packageName)) {
            return;
        }
        this.knownPackageNames.add(packageName);
        try {
            const pkgJsonPath = require.resolve(`${packageName}/package.json`);
            this.subscribePath(path.dirname(pkgJsonPath));
        } catch (e) {
            // ignore
        }
    }
}
