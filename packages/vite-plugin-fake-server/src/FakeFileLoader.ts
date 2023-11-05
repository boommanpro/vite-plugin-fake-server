import { getFakeFilePath, parallelLoader, esbuildBundler, moduleFromString } from "./node";
import type { FakeRoute } from "./node";
import type { ResolvePluginOptionsType } from "./resolvePluginOptions";
import type { Logger } from "./utils";
import { convertPathToPosix } from "./utils";
import chokidar from "chokidar";
import EventEmitter from "node:events";
import type { FSWatcher } from "node:fs";
import { join } from "node:path";
import colors from "picocolors";

export interface FakeFileLoaderOptions extends ResolvePluginOptionsType {
	loggerOutput: Logger;
	root: string;
}

export class FakeFileLoader extends EventEmitter {
	#moduleCache = new Map<string, FakeRoute[]>();
	#fakeData: FakeRoute[] = [];
	watcher!: FSWatcher;

	constructor(public options: FakeFileLoaderOptions) {
		super();
		this.options = options;
	}

	get fakeData() {
		return this.#fakeData;
	}

	async start() {
		// console.time("loader");
		const { include, exclude, extensions, infixName, root } = this.options;
		const fakeFilePathArr = getFakeFilePath({ exclude, include: [include], extensions, infixName }, root);

		// 5.402s => 1.309s
		// this.updateFakeData(await getFakeModule(fakeFilePathArr, this.options.loggerOutput));

		const fakeFilePathFunc = fakeFilePathArr.map((file) => () => this.loadFakeData(file));
		// TODO: Try to Web Worker
		await parallelLoader(fakeFilePathFunc, 10);
		this.updateFakeData();
		// console.timeEnd("loader");

		this.watchFake();
	}

	private async watchFake() {
		const { include, watch, root, exclude, loggerOutput, extensions, infixName } = this.options;
		if (include && include.length && watch) {
			const watchDir = convertPathToPosix(join(include, `/**/*.${infixName}.{${extensions.join(",")}}`));
			const watcher = chokidar.watch(watchDir, {
				cwd: root,
				ignoreInitial: true,
				ignored: exclude,
			});
			this.watcher = watcher;

			watcher.on("add", async (relativeFilePath) => {
				loggerOutput.info(colors.green(`fake file add ` + colors.dim(relativeFilePath)), {
					timestamp: true,
					clear: true,
				});

				const absoluteFilePath = join(root, relativeFilePath);
				const posixStyleFilePath = convertPathToPosix(absoluteFilePath);
				await this.loadFakeData(posixStyleFilePath);
				this.updateFakeData();
			});

			watcher.on("change", async (relativeFilePath) => {
				loggerOutput.info(colors.green(`fake file change ` + colors.dim(relativeFilePath)), {
					timestamp: true,
					clear: true,
				});

				const absoluteFilePath = join(root, relativeFilePath);
				const posixStyleFilePath = convertPathToPosix(absoluteFilePath);
				await this.loadFakeData(posixStyleFilePath);
				this.updateFakeData();
			});

			watcher.on("unlink", async (relativeFilePath) => {
				loggerOutput.info(colors.green(`fake file unlink ` + colors.dim(relativeFilePath)), {
					timestamp: true,
					clear: true,
				});

				const absoluteFilePath = join(root, relativeFilePath);
				const posixStyleFilePath = convertPathToPosix(absoluteFilePath);
				this.#moduleCache.delete(posixStyleFilePath);

				this.updateFakeData();
			});
		}
	}

	private async loadFakeData(filepath: string) {
		const fakeCodeData = [];
		try {
			const { code } = await esbuildBundler(filepath);
			const mod = await moduleFromString(filepath, code);
			const resolvedModule = mod.default || mod;
			if (Array.isArray(resolvedModule)) {
				fakeCodeData.push(...resolvedModule);
			} else {
				fakeCodeData.push(resolvedModule);
			}
		} catch (error) {
			this.options.loggerOutput.error(colors.red(`failed to load module from ${filepath}`), {
				error: error as Error,
				timestamp: true,
			});
		}

		this.#moduleCache.set(filepath, fakeCodeData);
		return fakeCodeData;
	}

	private updateFakeData() {
		let fakeData: FakeRoute[] = [];
		for (const value of this.#moduleCache.values()) {
			fakeData = [...fakeData, ...value];
		}
		this.#fakeData = fakeData;
	}

	close() {
		this.watcher?.close();
	}
}
