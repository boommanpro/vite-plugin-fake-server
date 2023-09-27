import { existsSync } from "node:fs";
import { join, extname } from "node:path";
import fg from "fast-glob";

import type { FakerSchemaServerOptions } from "./types";
import { resolveModule } from "./resolveModule";
import { logger } from "./utils";

export async function getFakeConfig(options: FakerSchemaServerOptions = {}) {
	const { include, exclude } = options;
	if (!Array.isArray(include) || include.length === 0) {
		return [];
	}

	const extensions = ["ts", "js", "cjs", "mjs"];
	const cwd = process.cwd();
	const fastGlobOptions = {
		cwd,
		ignore: exclude,
	};

	const getFakeFilePath = include.reduce<string[]>((acc, filePath) => {
		const absFilePath = join(cwd, filePath);
		if (existsSync(absFilePath)) {
			// file
			const fileExtname = extname(absFilePath).slice(1);
			if (fileExtname) {
				if (extensions.includes(fileExtname)) {
					const fakeFiles = fg.sync(filePath, fastGlobOptions);
					return [...acc, ...fakeFiles];
				}
				return acc;
			}

			// folder
			const dir = join(filePath, "/");
			const fakeFolderFiles = fg.sync(`${dir}**/*.{${extensions.join(",")}}`, fastGlobOptions);
			return [...acc, ...fakeFolderFiles];
		}
		return acc;
	}, []);

	const ret = [];
	for (const absoluteFilePath of getFakeFilePath) {
		try {
			const resolvedModule = await resolveModule(absoluteFilePath);
			if (Array.isArray(resolvedModule)) {
				ret.push(...resolvedModule);
			} else {
				ret.push(resolvedModule);
			}
		} catch (error) {
			logger(`load module error`, error as string, "error");
		}
	}

	return ret;
}
