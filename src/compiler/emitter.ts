namespace ts {
    const brackets = createBracketsMap();

    /*@internal*/
    export function isBuildInfoFile(file: string) {
        return fileExtensionIs(file, Extension.TsBuildInfo);
    }

    /*@internal*/
    /**
     * Iterates over the source files that are expected to have an emit output.
     *
     * @param host An EmitHost.
     * @param action The action to execute.
     * @param sourceFilesOrTargetSourceFile
     *   If an array, the full list of source files to emit.
     *   Else, calls `getSourceFilesToEmit` with the (optional) target source file to determine the list of source files to emit.
     */
    export function forEachEmittedFile<T>(
        host: EmitHost, action: (emitFileNames: EmitFileNames, sourceFileOrBundle: SourceFile | Bundle | undefined) => T,
        sourceFilesOrTargetSourceFile?: readonly SourceFile[] | SourceFile,
        forceDtsEmit = false,
        onlyBuildInfo?: boolean,
        includeBuildInfo?: boolean) {
        const sourceFiles = isArray(sourceFilesOrTargetSourceFile) ? sourceFilesOrTargetSourceFile : getSourceFilesToEmit(host, sourceFilesOrTargetSourceFile, forceDtsEmit);
        const options = host.getCompilerOptions();
        if (outFile(options)) {
            const prepends = host.getPrependNodes();
            if (sourceFiles.length || prepends.length) {
                const bundle = factory.createBundle(sourceFiles, prepends);
                const result = action(getOutputPathsFor(bundle, host, forceDtsEmit), bundle);
                if (result) {
                    return result;
                }
            }
        }
        else {
            if (!onlyBuildInfo) {
                for (const sourceFile of sourceFiles) {
                    const result = action(getOutputPathsFor(sourceFile, host, forceDtsEmit), sourceFile);
                    if (result) {
                        return result;
                    }
                }
            }
            if (includeBuildInfo) {
                const buildInfoPath = getTsBuildInfoEmitOutputFilePath(options);
                if (buildInfoPath) return action({ buildInfoPath }, /*sourceFileOrBundle*/ undefined);
            }
        }
    }

    export function getTsBuildInfoEmitOutputFilePath(options: CompilerOptions) {
        const configFile = options.configFilePath;
        if (!isIncrementalCompilation(options)) return undefined;
        if (options.tsBuildInfoFile) return options.tsBuildInfoFile;
        const outPath = outFile(options);
        let buildInfoExtensionLess: string;
        if (outPath) {
            buildInfoExtensionLess = removeFileExtension(outPath);
        }
        else {
            if (!configFile) return undefined;
            const configFileExtensionLess = removeFileExtension(configFile);
            buildInfoExtensionLess = options.outDir ?
                options.rootDir ?
                    resolvePath(options.outDir, getRelativePathFromDirectory(options.rootDir, configFileExtensionLess, /*ignoreCase*/ true)) :
                    combinePaths(options.outDir, getBaseFileName(configFileExtensionLess)) :
                configFileExtensionLess;
        }
        return buildInfoExtensionLess + Extension.TsBuildInfo;
    }

    /*@internal*/
    export function getOutputPathsForBundle(options: CompilerOptions, forceDtsPaths: boolean): EmitFileNames {
        const outPath = outFile(options)!;
        const jsFilePath = options.emitDeclarationOnly ? undefined : outPath;
        const sourceMapFilePath = jsFilePath && getSourceMapFilePath(jsFilePath, options);
        const declarationFilePath = (forceDtsPaths || getEmitDeclarations(options)) ? removeFileExtension(outPath) + Extension.Dts : undefined;
        const declarationMapPath = declarationFilePath && getAreDeclarationMapsEnabled(options) ? declarationFilePath + ".map" : undefined;
        const buildInfoPath = getTsBuildInfoEmitOutputFilePath(options);
        return { jsFilePath, sourceMapFilePath, declarationFilePath, declarationMapPath, buildInfoPath };
    }

    /*@internal*/
    export function getOutputPathsFor(sourceFile: SourceFile | Bundle, host: EmitHost, forceDtsPaths: boolean): EmitFileNames {
        const options = host.getCompilerOptions();
        if (sourceFile.kind === SyntaxKind.Bundle) {
            return getOutputPathsForBundle(options, forceDtsPaths);
        }
        else {
            const ownOutputFilePath = getOwnEmitOutputFilePath(sourceFile.fileName, host, getOutputExtension(sourceFile.fileName, options));
            let qjsFilePath: string | undefined;
            if (!!options.emitQJSCode) {
                qjsFilePath = getOwnEmitOutputFilePath(sourceFile.fileName, host, Extension.Qjs);
            }
            const isJsonFile = isJsonSourceFile(sourceFile);
            // If json file emits to the same location skip writing it, if emitDeclarationOnly skip writing it
            const isJsonEmittedToSameLocation = isJsonFile &&
                comparePaths(sourceFile.fileName, ownOutputFilePath, host.getCurrentDirectory(), !host.useCaseSensitiveFileNames()) === Comparison.EqualTo;
            const jsFilePath = options.emitDeclarationOnly || isJsonEmittedToSameLocation ? undefined : ownOutputFilePath;
            const sourceMapFilePath = !jsFilePath || isJsonSourceFile(sourceFile) ? undefined : getSourceMapFilePath(jsFilePath, options);
            const declarationFilePath = (forceDtsPaths || (getEmitDeclarations(options) && !isJsonFile)) ? getDeclarationEmitOutputFilePath(sourceFile.fileName, host) : undefined;
            const declarationMapPath = declarationFilePath && getAreDeclarationMapsEnabled(options) ? declarationFilePath + ".map" : undefined;
            return { jsFilePath, qjsFilePath, sourceMapFilePath, declarationFilePath, declarationMapPath, buildInfoPath: undefined };
        }
    }

    function getSourceMapFilePath(jsFilePath: string, options: CompilerOptions) {
        return (options.sourceMap && !options.inlineSourceMap) ? jsFilePath + ".map" : undefined;
    }

    /* @internal */
    export function getOutputExtension(fileName: string, options: CompilerOptions): Extension {
        return fileExtensionIs(fileName, Extension.Json) ? Extension.Json :
        options.jsx === JsxEmit.Preserve && fileExtensionIsOneOf(fileName, [Extension.Jsx, Extension.Tsx]) ? Extension.Jsx :
        fileExtensionIsOneOf(fileName, [Extension.Mts, Extension.Mjs]) ? Extension.Mjs :
        fileExtensionIsOneOf(fileName, [Extension.Cts, Extension.Cjs]) ? Extension.Cjs :
        Extension.Js;
    }

    function getOutputPathWithoutChangingExt(inputFileName: string, configFile: ParsedCommandLine, ignoreCase: boolean, outputDir: string | undefined, getCommonSourceDirectory?: () => string) {
        return outputDir ?
            resolvePath(
                outputDir,
                getRelativePathFromDirectory(getCommonSourceDirectory ? getCommonSourceDirectory() : getCommonSourceDirectoryOfConfig(configFile, ignoreCase), inputFileName, ignoreCase)
            ) :
            inputFileName;
    }

    /* @internal */
    export function getOutputDeclarationFileName(inputFileName: string, configFile: ParsedCommandLine, ignoreCase: boolean, getCommonSourceDirectory?: () => string) {
        return changeExtension(
            getOutputPathWithoutChangingExt(inputFileName, configFile, ignoreCase, configFile.options.declarationDir || configFile.options.outDir, getCommonSourceDirectory),
            getDeclarationEmitExtensionForPath(inputFileName)
        );
    }

    function getOutputJSFileName(inputFileName: string, configFile: ParsedCommandLine, ignoreCase: boolean, getCommonSourceDirectory?: () => string) {
        if (configFile.options.emitDeclarationOnly) return undefined;
        const isJsonFile = fileExtensionIs(inputFileName, Extension.Json);
        const outputFileName = changeExtension(
            getOutputPathWithoutChangingExt(inputFileName, configFile, ignoreCase, configFile.options.outDir, getCommonSourceDirectory),
            getOutputExtension(inputFileName, configFile.options)
        );
        return !isJsonFile || comparePaths(inputFileName, outputFileName, Debug.checkDefined(configFile.options.configFilePath), ignoreCase) !== Comparison.EqualTo ?
            outputFileName :
            undefined;
    }

    function createAddOutput() {
        let outputs: string[] | undefined;
        return { addOutput, getOutputs };
        function addOutput(path: string | undefined) {
            if (path) {
                (outputs || (outputs = [])).push(path);
            }
        }
        function getOutputs(): readonly string[] {
            return outputs || emptyArray;
        }
    }

    function getSingleOutputFileNames(configFile: ParsedCommandLine, addOutput: ReturnType<typeof createAddOutput>["addOutput"]) {
        const { jsFilePath, sourceMapFilePath, declarationFilePath, declarationMapPath, buildInfoPath } = getOutputPathsForBundle(configFile.options, /*forceDtsPaths*/ false);
        addOutput(jsFilePath);
        addOutput(sourceMapFilePath);
        addOutput(declarationFilePath);
        addOutput(declarationMapPath);
        addOutput(buildInfoPath);
    }

    function getOwnOutputFileNames(configFile: ParsedCommandLine, inputFileName: string, ignoreCase: boolean, addOutput: ReturnType<typeof createAddOutput>["addOutput"], getCommonSourceDirectory?: () => string) {
        if (isDeclarationFileName(inputFileName)) return;
        const js = getOutputJSFileName(inputFileName, configFile, ignoreCase, getCommonSourceDirectory);
        addOutput(js);
        if (fileExtensionIs(inputFileName, Extension.Json)) return;
        if (js && configFile.options.sourceMap) {
            addOutput(`${js}.map`);
        }
        if (getEmitDeclarations(configFile.options)) {
            const dts = getOutputDeclarationFileName(inputFileName, configFile, ignoreCase, getCommonSourceDirectory);
            addOutput(dts);
            if (configFile.options.declarationMap) {
                addOutput(`${dts}.map`);
            }
        }
    }

    /*@internal*/
    export function getCommonSourceDirectory(
        options: CompilerOptions,
        emittedFiles: () => readonly string[],
        currentDirectory: string,
        getCanonicalFileName: GetCanonicalFileName,
        checkSourceFilesBelongToPath?: (commonSourceDirectory: string) => void
    ): string {
        let commonSourceDirectory;
        if (options.rootDir) {
            // If a rootDir is specified use it as the commonSourceDirectory
            commonSourceDirectory = getNormalizedAbsolutePath(options.rootDir, currentDirectory);
            checkSourceFilesBelongToPath?.(options.rootDir);
        }
        else if (options.composite && options.configFilePath) {
            // Project compilations never infer their root from the input source paths
            commonSourceDirectory = getDirectoryPath(normalizeSlashes(options.configFilePath));
            checkSourceFilesBelongToPath?.(commonSourceDirectory);
        }
        else {
            commonSourceDirectory = computeCommonSourceDirectoryOfFilenames(emittedFiles(), currentDirectory, getCanonicalFileName);
        }

        if (commonSourceDirectory && commonSourceDirectory[commonSourceDirectory.length - 1] !== directorySeparator) {
            // Make sure directory path ends with directory separator so this string can directly
            // used to replace with "" to get the relative path of the source file and the relative path doesn't
            // start with / making it rooted path
            commonSourceDirectory += directorySeparator;
        }
        return commonSourceDirectory;
    }

    /*@internal*/
    export function getCommonSourceDirectoryOfConfig({ options, fileNames }: ParsedCommandLine, ignoreCase: boolean): string {
        return getCommonSourceDirectory(
            options,
            () => filter(fileNames, file => !(options.noEmitForJsFiles && fileExtensionIsOneOf(file, supportedJSExtensionsFlat)) && !isDeclarationFileName(file)),
            getDirectoryPath(normalizeSlashes(Debug.checkDefined(options.configFilePath))),
            createGetCanonicalFileName(!ignoreCase)
        );
    }

    /*@internal*/
    export function getAllProjectOutputs(configFile: ParsedCommandLine, ignoreCase: boolean): readonly string[] {
        const { addOutput, getOutputs } = createAddOutput();
        if (outFile(configFile.options)) {
            getSingleOutputFileNames(configFile, addOutput);
        }
        else {
            const getCommonSourceDirectory = memoize(() => getCommonSourceDirectoryOfConfig(configFile, ignoreCase));
            for (const inputFileName of configFile.fileNames) {
                getOwnOutputFileNames(configFile, inputFileName, ignoreCase, addOutput, getCommonSourceDirectory);
            }
            addOutput(getTsBuildInfoEmitOutputFilePath(configFile.options));
        }
        return getOutputs();
    }

    export function getOutputFileNames(commandLine: ParsedCommandLine, inputFileName: string, ignoreCase: boolean): readonly string[] {
        inputFileName = normalizePath(inputFileName);
        Debug.assert(contains(commandLine.fileNames, inputFileName), `Expected fileName to be present in command line`);
        const { addOutput, getOutputs } = createAddOutput();
        if (outFile(commandLine.options)) {
            getSingleOutputFileNames(commandLine, addOutput);
        }
        else {
            getOwnOutputFileNames(commandLine, inputFileName, ignoreCase, addOutput);
        }
        return getOutputs();
    }

    /*@internal*/
    export function getFirstProjectOutput(configFile: ParsedCommandLine, ignoreCase: boolean): string {
        if (outFile(configFile.options)) {
            const { jsFilePath } = getOutputPathsForBundle(configFile.options, /*forceDtsPaths*/ false);
            return Debug.checkDefined(jsFilePath, `project ${configFile.options.configFilePath} expected to have at least one output`);
        }

        const getCommonSourceDirectory = memoize(() => getCommonSourceDirectoryOfConfig(configFile, ignoreCase));
        for (const inputFileName of configFile.fileNames) {
            if (isDeclarationFileName(inputFileName)) continue;
            const jsFilePath = getOutputJSFileName(inputFileName, configFile, ignoreCase, getCommonSourceDirectory);
            if (jsFilePath) return jsFilePath;
            if (fileExtensionIs(inputFileName, Extension.Json)) continue;
            if (getEmitDeclarations(configFile.options)) {
                return getOutputDeclarationFileName(inputFileName, configFile, ignoreCase, getCommonSourceDirectory);
            }
        }
        const buildInfoPath = getTsBuildInfoEmitOutputFilePath(configFile.options);
        if (buildInfoPath) return buildInfoPath;
        return Debug.fail(`project ${configFile.options.configFilePath} expected to have at least one output`);
    }

    /*@internal*/
    // targetSourceFile is when users only want one file in entire project to be emitted. This is used in compileOnSave feature
    export function emitFiles(resolver: EmitResolver, host: EmitHost, targetSourceFile: SourceFile | undefined, { scriptTransformers, declarationTransformers }: EmitTransformers, emitOnlyDtsFiles?: boolean, onlyBuildInfo?: boolean, forceDtsEmit?: boolean): EmitResult {
        const compilerOptions = host.getCompilerOptions();
        const sourceMapDataList: SourceMapEmitResult[] | undefined = (compilerOptions.sourceMap || compilerOptions.inlineSourceMap || getAreDeclarationMapsEnabled(compilerOptions)) ? [] : undefined;
        const emittedFilesList: string[] | undefined = compilerOptions.listEmittedFiles ? [] : undefined;
        const emitterDiagnostics = createDiagnosticCollection();
        const newLine = getNewLineCharacter(compilerOptions, () => host.getNewLine());
        const writer = createTextWriter(newLine);
        const qjsWriter = !!compilerOptions.emitQJSCode ? createTextWriter(newLine) : undefined;
        const { enter, exit } = performance.createTimer("printTime", "beforePrint", "afterPrint");
        let bundleBuildInfo: BundleBuildInfo | undefined;
        let emitSkipped = false;
        let exportedModulesFromDeclarationEmit: ExportedModulesFromDeclarationEmit | undefined;

        // Emit each output file
        enter();
        forEachEmittedFile(
            host,
            emitSourceFileOrBundle,
            getSourceFilesToEmit(host, targetSourceFile, forceDtsEmit),
            forceDtsEmit,
            onlyBuildInfo,
            !targetSourceFile
        );
        exit();


        return {
            emitSkipped,
            diagnostics: emitterDiagnostics.getDiagnostics(),
            emittedFiles: emittedFilesList,
            sourceMaps: sourceMapDataList,
            exportedModulesFromDeclarationEmit
        };

        function emitSourceFileOrBundle({ jsFilePath, qjsFilePath, sourceMapFilePath, declarationFilePath, declarationMapPath, buildInfoPath }: EmitFileNames, sourceFileOrBundle: SourceFile | Bundle | undefined) {
            let buildInfoDirectory: string | undefined;
            if (buildInfoPath && sourceFileOrBundle && isBundle(sourceFileOrBundle)) {
                buildInfoDirectory = getDirectoryPath(getNormalizedAbsolutePath(buildInfoPath, host.getCurrentDirectory()));
                bundleBuildInfo = {
                    commonSourceDirectory: relativeToBuildInfo(host.getCommonSourceDirectory()),
                    sourceFiles: sourceFileOrBundle.sourceFiles.map(file => relativeToBuildInfo(getNormalizedAbsolutePath(file.fileName, host.getCurrentDirectory())))
                };
            }
            tracing?.push(tracing.Phase.Emit, "emitJsFileOrBundle", { jsFilePath });
            emitJsFileOrBundle(sourceFileOrBundle, jsFilePath, qjsFilePath, sourceMapFilePath, relativeToBuildInfo);
            tracing?.pop();

            tracing?.push(tracing.Phase.Emit, "emitDeclarationFileOrBundle", { declarationFilePath });
            emitDeclarationFileOrBundle(sourceFileOrBundle, declarationFilePath, declarationMapPath, relativeToBuildInfo);
            tracing?.pop();

            tracing?.push(tracing.Phase.Emit, "emitBuildInfo", { buildInfoPath });
            emitBuildInfo(bundleBuildInfo, buildInfoPath);
            tracing?.pop();

            if (!emitSkipped && emittedFilesList) {
                if (!emitOnlyDtsFiles) {
                    if (jsFilePath) {
                        emittedFilesList.push(jsFilePath);
                    }
                    if (sourceMapFilePath) {
                        emittedFilesList.push(sourceMapFilePath);
                    }
                    if (buildInfoPath) {
                        emittedFilesList.push(buildInfoPath);
                    }
                }
                if (declarationFilePath) {
                    emittedFilesList.push(declarationFilePath);
                }
                if (declarationMapPath) {
                    emittedFilesList.push(declarationMapPath);
                }
            }

            function relativeToBuildInfo(path: string) {
                return ensurePathIsNonModuleName(getRelativePathFromDirectory(buildInfoDirectory!, path, host.getCanonicalFileName));
            }
        }

        function emitBuildInfo(bundle: BundleBuildInfo | undefined, buildInfoPath: string | undefined) {
            // Write build information if applicable
            if (!buildInfoPath || targetSourceFile || emitSkipped) return;
            const program = host.getProgramBuildInfo();
            if (host.isEmitBlocked(buildInfoPath)) {
                emitSkipped = true;
                return;
            }
            const version = ts.version; // Extracted into a const so the form is stable between namespace and module
            writeFile(host, emitterDiagnostics, buildInfoPath, getBuildInfoText({ bundle, program, version }), /*writeByteOrderMark*/ false);
        }

        function emitJsFileOrBundle(
            sourceFileOrBundle: SourceFile | Bundle | undefined,
            jsFilePath: string | undefined,
            qjsFilePath: string | undefined,
            sourceMapFilePath: string | undefined,
            relativeToBuildInfo: (path: string) => string) {
            if (!sourceFileOrBundle || emitOnlyDtsFiles || !jsFilePath) {
                return;
            }

            // Make sure not to write js file and source map file if any of them cannot be written
            if ((jsFilePath && host.isEmitBlocked(jsFilePath)) || compilerOptions.noEmit) {
                emitSkipped = true;
                return;
            }
            // Transform the source files
            const transform = transformNodes(resolver, host, factory, compilerOptions, [sourceFileOrBundle], scriptTransformers, /*allowDtsFiles*/ false);

            const printerOptions: PrinterOptions = {
                removeComments: compilerOptions.removeComments,
                newLine: compilerOptions.newLine,
                noEmitHelpers: compilerOptions.noEmitHelpers,
                emitQJSCode: compilerOptions.emitQJSCode,
                emitQJSIR: compilerOptions.emitQJSIR,
                module: compilerOptions.module,
                target: compilerOptions.target,
                sourceMap: compilerOptions.sourceMap,
                inlineSourceMap: compilerOptions.inlineSourceMap,
                inlineSources: compilerOptions.inlineSources,
                extendedDiagnostics: compilerOptions.extendedDiagnostics,
                writeBundleFileInfo: !!bundleBuildInfo,
                relativeToBuildInfo
            };

            // Create a printer to print the nodes
            const printer = createPrinter(printerOptions, {
                getTypeChecker: resolver.getTypeChecker,
                // resolver hooks
                hasGlobalName: resolver.hasGlobalName,

                // transform hooks
                onEmitNode: transform.emitNodeWithNotification,
                isEmitNotificationEnabled: transform.isEmitNotificationEnabled,
                substituteNode: transform.substituteNode,
            });

            Debug.assert(transform.transformed.length === 1, "Should only see one output from the transform");
            if (!compilerOptions.emitQJSCode || !qjsFilePath) {
                qjsFilePath = "";
            }
            printSourceFileOrBundle(jsFilePath, qjsFilePath, sourceMapFilePath, transform.transformed[0], printer, compilerOptions);

            // Clean up emit nodes on parse tree
            transform.dispose();
            if (bundleBuildInfo) bundleBuildInfo.js = printer.bundleFileInfo;
        }

        function emitDeclarationFileOrBundle(
            sourceFileOrBundle: SourceFile | Bundle | undefined,
            declarationFilePath: string | undefined,
            declarationMapPath: string | undefined,
            relativeToBuildInfo: (path: string) => string) {
            if (!sourceFileOrBundle) return;
            if (!declarationFilePath) {
                if (emitOnlyDtsFiles || compilerOptions.emitDeclarationOnly) emitSkipped = true;
                return;
            }
            const sourceFiles = isSourceFile(sourceFileOrBundle) ? [sourceFileOrBundle] : sourceFileOrBundle.sourceFiles;
            const filesForEmit = forceDtsEmit ? sourceFiles : filter(sourceFiles, isSourceFileNotJson);
            // Setup and perform the transformation to retrieve declarations from the input files
            const inputListOrBundle = outFile(compilerOptions) ? [factory.createBundle(filesForEmit, !isSourceFile(sourceFileOrBundle) ? sourceFileOrBundle.prepends : undefined)] : filesForEmit;
            if (emitOnlyDtsFiles && !getEmitDeclarations(compilerOptions)) {
                // Checker wont collect the linked aliases since thats only done when declaration is enabled.
                // Do that here when emitting only dts files
                filesForEmit.forEach(collectLinkedAliases);
            }
            const declarationTransform = transformNodes(resolver, host, factory, compilerOptions, inputListOrBundle, declarationTransformers, /*allowDtsFiles*/ false);
            if (length(declarationTransform.diagnostics)) {
                for (const diagnostic of declarationTransform.diagnostics!) {
                    emitterDiagnostics.add(diagnostic);
                }
            }

            const printerOptions: PrinterOptions = {
                removeComments: compilerOptions.removeComments,
                newLine: compilerOptions.newLine,
                noEmitHelpers: true,
                module: compilerOptions.module,
                target: compilerOptions.target,
                sourceMap: compilerOptions.sourceMap,
                inlineSourceMap: compilerOptions.inlineSourceMap,
                extendedDiagnostics: compilerOptions.extendedDiagnostics,
                onlyPrintJsDocStyle: true,
                writeBundleFileInfo: !!bundleBuildInfo,
                recordInternalSection: !!bundleBuildInfo,
                relativeToBuildInfo
            };

            const declarationPrinter = createPrinter(printerOptions, {
                // resolver hooks
                hasGlobalName: resolver.hasGlobalName,

                // transform hooks
                onEmitNode: declarationTransform.emitNodeWithNotification,
                isEmitNotificationEnabled: declarationTransform.isEmitNotificationEnabled,
                substituteNode: declarationTransform.substituteNode,
            });
            const declBlocked = (!!declarationTransform.diagnostics && !!declarationTransform.diagnostics.length) || !!host.isEmitBlocked(declarationFilePath) || !!compilerOptions.noEmit;
            emitSkipped = emitSkipped || declBlocked;
            if (!declBlocked || forceDtsEmit) {
                Debug.assert(declarationTransform.transformed.length === 1, "Should only see one output from the decl transform");
                printSourceFileOrBundle(
                    declarationFilePath,
                    "",
                    declarationMapPath,
                    declarationTransform.transformed[0],
                    declarationPrinter,
                    {
                        sourceMap: !forceDtsEmit && compilerOptions.declarationMap,
                        sourceRoot: compilerOptions.sourceRoot,
                        mapRoot: compilerOptions.mapRoot,
                        extendedDiagnostics: compilerOptions.extendedDiagnostics,
                        // Explicitly do not passthru either `inline` option
                    }
                );
                if (forceDtsEmit && declarationTransform.transformed[0].kind === SyntaxKind.SourceFile) {
                    const sourceFile = declarationTransform.transformed[0];
                    exportedModulesFromDeclarationEmit = sourceFile.exportedModulesFromDeclarationEmit;
                }
            }
            declarationTransform.dispose();
            if (bundleBuildInfo) bundleBuildInfo.dts = declarationPrinter.bundleFileInfo;
        }

        function collectLinkedAliases(node: Node) {
            if (isExportAssignment(node)) {
                if (node.expression.kind === SyntaxKind.Identifier) {
                    resolver.collectLinkedAliases(node.expression as Identifier, /*setVisibility*/ true);
                }
                return;
            }
            else if (isExportSpecifier(node)) {
                resolver.collectLinkedAliases(node.propertyName || node.name, /*setVisibility*/ true);
                return;
            }
            forEachChild(node, collectLinkedAliases);
        }

        function printSourceFileOrBundle(jsFilePath: string, qjsFilePath: string | undefined, sourceMapFilePath: string | undefined, sourceFileOrBundle: SourceFile | Bundle, printer: Printer, mapOptions: SourceMapOptions) {
            const bundle = sourceFileOrBundle.kind === SyntaxKind.Bundle ? sourceFileOrBundle : undefined;
            const sourceFile = sourceFileOrBundle.kind === SyntaxKind.SourceFile ? sourceFileOrBundle : undefined;
            const sourceFiles = bundle ? bundle.sourceFiles : [sourceFile!];

            let sourceMapGenerator: SourceMapGenerator | undefined;
            if (shouldEmitSourceMaps(mapOptions, sourceFileOrBundle)) {
                sourceMapGenerator = createSourceMapGenerator(
                    host,
                    getBaseFileName(normalizeSlashes(jsFilePath)),
                    getSourceRoot(mapOptions),
                    getSourceMapDirectory(mapOptions, jsFilePath, sourceFile),
                    mapOptions);
            }

            if (bundle) {
                printer.writeBundle(bundle, writer, qjsWriter, sourceMapGenerator);
            }
            else {
                printer.writeFile(sourceFile!, writer, qjsWriter, sourceMapGenerator);
            }

            if (sourceMapGenerator) {
                if (sourceMapDataList) {
                    sourceMapDataList.push({
                        inputSourceFileNames: sourceMapGenerator.getSources(),
                        sourceMap: sourceMapGenerator.toJSON()
                    });
                }

                const sourceMappingURL = getSourceMappingURL(
                    mapOptions,
                    sourceMapGenerator,
                    jsFilePath,
                    sourceMapFilePath,
                    sourceFile);

                if (sourceMappingURL) {
                    if (!writer.isAtStartOfLine()) writer.rawWrite(newLine);
                    writer.writeComment(`//# ${"sourceMappingURL"}=${sourceMappingURL}`); // Tools can sometimes see this line as a source mapping url comment
                }

                // Write the source map
                if (sourceMapFilePath) {
                    const sourceMap = sourceMapGenerator.toString();
                    writeFile(host, emitterDiagnostics, sourceMapFilePath, sourceMap, /*writeByteOrderMark*/ false, sourceFiles);
                }
            }
            else {
                writer.writeLine();
            }

            // Write the output file
            writeFile(host, emitterDiagnostics, jsFilePath, writer.getText(), !!compilerOptions.emitBOM, sourceFiles);
            if (!!compilerOptions.emitQJSCode) {
                writeFile(host, emitterDiagnostics, qjsFilePath!, qjsWriter!.getText(), !!compilerOptions.emitBOM, sourceFiles);
                qjsWriter!.clear();
            }
            // Reset state
            writer.clear();
        }

        interface SourceMapOptions {
            sourceMap?: boolean;
            inlineSourceMap?: boolean;
            inlineSources?: boolean;
            sourceRoot?: string;
            mapRoot?: string;
            extendedDiagnostics?: boolean;
        }

        function shouldEmitSourceMaps(mapOptions: SourceMapOptions, sourceFileOrBundle: SourceFile | Bundle) {
            return (mapOptions.sourceMap || mapOptions.inlineSourceMap)
                && (sourceFileOrBundle.kind !== SyntaxKind.SourceFile || !fileExtensionIs(sourceFileOrBundle.fileName, Extension.Json));
        }

        function getSourceRoot(mapOptions: SourceMapOptions) {
            // Normalize source root and make sure it has trailing "/" so that it can be used to combine paths with the
            // relative paths of the sources list in the sourcemap
            const sourceRoot = normalizeSlashes(mapOptions.sourceRoot || "");
            return sourceRoot ? ensureTrailingDirectorySeparator(sourceRoot) : sourceRoot;
        }

        function getSourceMapDirectory(mapOptions: SourceMapOptions, filePath: string, sourceFile: SourceFile | undefined) {
            if (mapOptions.sourceRoot) return host.getCommonSourceDirectory();
            if (mapOptions.mapRoot) {
                let sourceMapDir = normalizeSlashes(mapOptions.mapRoot);
                if (sourceFile) {
                    // For modules or multiple emit files the mapRoot will have directory structure like the sources
                    // So if src\a.ts and src\lib\b.ts are compiled together user would be moving the maps into mapRoot\a.js.map and mapRoot\lib\b.js.map
                    sourceMapDir = getDirectoryPath(getSourceFilePathInNewDir(sourceFile.fileName, host, sourceMapDir));
                }
                if (getRootLength(sourceMapDir) === 0) {
                    // The relative paths are relative to the common directory
                    sourceMapDir = combinePaths(host.getCommonSourceDirectory(), sourceMapDir);
                }
                return sourceMapDir;
            }
            return getDirectoryPath(normalizePath(filePath));
        }

        function getSourceMappingURL(mapOptions: SourceMapOptions, sourceMapGenerator: SourceMapGenerator, filePath: string, sourceMapFilePath: string | undefined, sourceFile: SourceFile | undefined) {
            if (mapOptions.inlineSourceMap) {
                // Encode the sourceMap into the sourceMap url
                const sourceMapText = sourceMapGenerator.toString();
                const base64SourceMapText = base64encode(sys, sourceMapText);
                return `data:application/json;base64,${base64SourceMapText}`;
            }

            const sourceMapFile = getBaseFileName(normalizeSlashes(Debug.checkDefined(sourceMapFilePath)));
            if (mapOptions.mapRoot) {
                let sourceMapDir = normalizeSlashes(mapOptions.mapRoot);
                if (sourceFile) {
                    // For modules or multiple emit files the mapRoot will have directory structure like the sources
                    // So if src\a.ts and src\lib\b.ts are compiled together user would be moving the maps into mapRoot\a.js.map and mapRoot\lib\b.js.map
                    sourceMapDir = getDirectoryPath(getSourceFilePathInNewDir(sourceFile.fileName, host, sourceMapDir));
                }
                if (getRootLength(sourceMapDir) === 0) {
                    // The relative paths are relative to the common directory
                    sourceMapDir = combinePaths(host.getCommonSourceDirectory(), sourceMapDir);
                    return encodeURI(
                        getRelativePathToDirectoryOrUrl(
                            getDirectoryPath(normalizePath(filePath)), // get the relative sourceMapDir path based on jsFilePath
                            combinePaths(sourceMapDir, sourceMapFile), // this is where user expects to see sourceMap
                            host.getCurrentDirectory(),
                            host.getCanonicalFileName,
                            /*isAbsolutePathAnUrl*/ true));
                }
                else {
                    return encodeURI(combinePaths(sourceMapDir, sourceMapFile));
                }
            }
            return encodeURI(sourceMapFile);
        }
    }

    /*@internal*/
    export function getBuildInfoText(buildInfo: BuildInfo) {
        return JSON.stringify(buildInfo);
    }

    /*@internal*/
    export function getBuildInfo(buildInfoText: string) {
        return JSON.parse(buildInfoText) as BuildInfo;
    }

    /*@internal*/
    export const notImplementedResolver: EmitResolver = {
        getTypeChecker: notImplemented,
        hasGlobalName: notImplemented,
        getReferencedExportContainer: notImplemented,
        getReferencedImportDeclaration: notImplemented,
        getReferencedDeclarationWithCollidingName: notImplemented,
        isDeclarationWithCollidingName: notImplemented,
        isValueAliasDeclaration: notImplemented,
        isReferencedAliasDeclaration: notImplemented,
        isTopLevelValueImportEqualsWithEntityName: notImplemented,
        getNodeCheckFlags: notImplemented,
        isDeclarationVisible: notImplemented,
        isLateBound: (_node): _node is LateBoundDeclaration => false,
        collectLinkedAliases: notImplemented,
        isImplementationOfOverload: notImplemented,
        isRequiredInitializedParameter: notImplemented,
        isOptionalUninitializedParameterProperty: notImplemented,
        isExpandoFunctionDeclaration: notImplemented,
        getPropertiesOfContainerFunction: notImplemented,
        createTypeOfDeclaration: notImplemented,
        createReturnTypeOfSignatureDeclaration: notImplemented,
        createTypeOfExpression: notImplemented,
        createLiteralConstValue: notImplemented,
        isSymbolAccessible: notImplemented,
        isEntityNameVisible: notImplemented,
        // Returns the constant value this property access resolves to: notImplemented, or 'undefined' for a non-constant
        getConstantValue: notImplemented,
        getReferencedValueDeclaration: notImplemented,
        getTypeReferenceSerializationKind: notImplemented,
        isOptionalParameter: notImplemented,
        moduleExportsSomeValue: notImplemented,
        isArgumentsLocalBinding: notImplemented,
        getExternalModuleFileFromDeclaration: notImplemented,
        getTypeReferenceDirectivesForEntityName: notImplemented,
        getTypeReferenceDirectivesForSymbol: notImplemented,
        isLiteralConstDeclaration: notImplemented,
        getJsxFactoryEntity: notImplemented,
        getJsxFragmentFactoryEntity: notImplemented,
        getAllAccessorDeclarations: notImplemented,
        getSymbolOfExternalModuleSpecifier: notImplemented,
        isBindingCapturedByNode: notImplemented,
        getDeclarationStatementsForSourceFile: notImplemented,
        isImportRequiredByAugmentation: notImplemented,
    };

    /*@internal*/
    /** File that isnt present resulting in error or output files */
    export type EmitUsingBuildInfoResult = string | readonly OutputFile[];

    /*@internal*/
    export interface EmitUsingBuildInfoHost extends ModuleResolutionHost {
        getCurrentDirectory(): string;
        getCanonicalFileName(fileName: string): string;
        useCaseSensitiveFileNames(): boolean;
        getNewLine(): string;
    }

    function createSourceFilesFromBundleBuildInfo(bundle: BundleBuildInfo, buildInfoDirectory: string, host: EmitUsingBuildInfoHost): readonly SourceFile[] {
        const jsBundle = Debug.checkDefined(bundle.js);
        const prologueMap = jsBundle.sources?.prologues && arrayToMap(jsBundle.sources.prologues, prologueInfo => prologueInfo.file);
        return bundle.sourceFiles.map((fileName, index) => {
            const prologueInfo = prologueMap?.get(index);
            const statements = prologueInfo?.directives.map(directive => {
                const literal = setTextRange(factory.createStringLiteral(directive.expression.text), directive.expression);
                const statement = setTextRange(factory.createExpressionStatement(literal), directive);
                setParent(literal, statement);
                return statement;
            });
            const eofToken = factory.createToken(SyntaxKind.EndOfFileToken);
            const sourceFile = factory.createSourceFile(statements ?? [], eofToken, NodeFlags.None);
            sourceFile.fileName = getRelativePathFromDirectory(
                host.getCurrentDirectory(),
                getNormalizedAbsolutePath(fileName, buildInfoDirectory),
                !host.useCaseSensitiveFileNames()
            );
            sourceFile.text = prologueInfo?.text ?? "";
            setTextRangePosWidth(sourceFile, 0, prologueInfo?.text.length ?? 0);
            setEachParent(sourceFile.statements, sourceFile);
            setTextRangePosWidth(eofToken, sourceFile.end, 0);
            setParent(eofToken, sourceFile);
            return sourceFile;
        });
    }

    /*@internal*/
    export function emitUsingBuildInfo(
        config: ParsedCommandLine,
        host: EmitUsingBuildInfoHost,
        getCommandLine: (ref: ProjectReference) => ParsedCommandLine | undefined,
        customTransformers?: CustomTransformers
    ): EmitUsingBuildInfoResult {
        const { buildInfoPath, jsFilePath, sourceMapFilePath, declarationFilePath, declarationMapPath } = getOutputPathsForBundle(config.options, /*forceDtsPaths*/ false);
        const buildInfoText = host.readFile(Debug.checkDefined(buildInfoPath));
        if (!buildInfoText) return buildInfoPath!;
        const jsFileText = host.readFile(Debug.checkDefined(jsFilePath));
        if (!jsFileText) return jsFilePath!;
        const sourceMapText = sourceMapFilePath && host.readFile(sourceMapFilePath);
        // error if no source map or for now if inline sourcemap
        if ((sourceMapFilePath && !sourceMapText) || config.options.inlineSourceMap) return sourceMapFilePath || "inline sourcemap decoding";
        // read declaration text
        const declarationText = declarationFilePath && host.readFile(declarationFilePath);
        if (declarationFilePath && !declarationText) return declarationFilePath;
        const declarationMapText = declarationMapPath && host.readFile(declarationMapPath);
        // error if no source map or for now if inline sourcemap
        if ((declarationMapPath && !declarationMapText) || config.options.inlineSourceMap) return declarationMapPath || "inline sourcemap decoding";

        const buildInfo = getBuildInfo(buildInfoText);
        if (!buildInfo.bundle || !buildInfo.bundle.js || (declarationText && !buildInfo.bundle.dts)) return buildInfoPath!;
        const buildInfoDirectory = getDirectoryPath(getNormalizedAbsolutePath(buildInfoPath!, host.getCurrentDirectory()));
        const ownPrependInput = createInputFiles(
            jsFileText,
            declarationText!,
            sourceMapFilePath,
            sourceMapText,
            declarationMapPath,
            declarationMapText,
            jsFilePath,
            declarationFilePath,
            buildInfoPath,
            buildInfo,
            /*onlyOwnText*/ true
        );
        const outputFiles: OutputFile[] = [];
        const prependNodes = createPrependNodes(config.projectReferences, getCommandLine, f => host.readFile(f));
        const sourceFilesForJsEmit = createSourceFilesFromBundleBuildInfo(buildInfo.bundle, buildInfoDirectory, host);
        const emitHost: EmitHost = {
            getPrependNodes: memoize(() => [...prependNodes, ownPrependInput]),
            getCanonicalFileName: host.getCanonicalFileName,
            getCommonSourceDirectory: () => getNormalizedAbsolutePath(buildInfo.bundle!.commonSourceDirectory, buildInfoDirectory),
            getCompilerOptions: () => config.options,
            getCurrentDirectory: () => host.getCurrentDirectory(),
            getNewLine: () => host.getNewLine(),
            getSourceFile: returnUndefined,
            getSourceFileByPath: returnUndefined,
            getSourceFiles: () => sourceFilesForJsEmit,
            getLibFileFromReference: notImplemented,
            isSourceFileFromExternalLibrary: returnFalse,
            getResolvedProjectReferenceToRedirect: returnUndefined,
            getProjectReferenceRedirect: returnUndefined,
            isSourceOfProjectReferenceRedirect: returnFalse,
            writeFile: (name, text, writeByteOrderMark) => {
                switch (name) {
                    case jsFilePath:
                        if (jsFileText === text) return;
                        break;
                    case sourceMapFilePath:
                        if (sourceMapText === text) return;
                        break;
                    case buildInfoPath:
                        const newBuildInfo = getBuildInfo(text);
                        newBuildInfo.program = buildInfo.program;
                        // Update sourceFileInfo
                        const { js, dts, sourceFiles } = buildInfo.bundle!;
                        newBuildInfo.bundle!.js!.sources = js!.sources;
                        if (dts) {
                            newBuildInfo.bundle!.dts!.sources = dts.sources;
                        }
                        newBuildInfo.bundle!.sourceFiles = sourceFiles;
                        outputFiles.push({ name, text: getBuildInfoText(newBuildInfo), writeByteOrderMark });
                        return;
                    case declarationFilePath:
                        if (declarationText === text) return;
                        break;
                    case declarationMapPath:
                        if (declarationMapText === text) return;
                        break;
                    default:
                        Debug.fail(`Unexpected path: ${name}`);
                }
                outputFiles.push({ name, text, writeByteOrderMark });
            },
            isEmitBlocked: returnFalse,
            readFile: f => host.readFile(f),
            fileExists: f => host.fileExists(f),
            useCaseSensitiveFileNames: () => host.useCaseSensitiveFileNames(),
            getProgramBuildInfo: returnUndefined,
            getSourceFileFromReference: returnUndefined,
            redirectTargetsMap: createMultiMap(),
            getFileIncludeReasons: notImplemented,
        };
        emitFiles(
            notImplementedResolver,
            emitHost,
            /*targetSourceFile*/ undefined,
            getTransformers(config.options, customTransformers)
        );
        return outputFiles;
    }

    const enum PipelinePhase {
        Notification,
        Substitution,
        Comments,
        SourceMaps,
        Emit,
    }

    export function createPrinter(printerOptions: PrinterOptions = {}, handlers: PrintHandlers = {}): Printer {
        const {
            getTypeChecker,
            hasGlobalName,
            onEmitNode = noEmitNotification,
            isEmitNotificationEnabled,
            substituteNode = noEmitSubstitution,
            onBeforeEmitNode,
            onAfterEmitNode,
            onBeforeEmitNodeArray,
            onAfterEmitNodeArray,
            onBeforeEmitToken,
            onAfterEmitToken
        } = handlers;

        const extendedDiagnostics = !!printerOptions.extendedDiagnostics;
        const newLine = getNewLineCharacter(printerOptions);
        const moduleKind = getEmitModuleKind(printerOptions);
        const bundledHelpers = new Map<string, boolean>();

        let currentSourceFile: SourceFile | undefined;
        let nodeIdToGeneratedName: string[]; // Map of generated names for specific nodes.
        let autoGeneratedIdToGeneratedName: string[]; // Map of generated names for temp and loop variables.
        let generatedNames: Set<string>; // Set of names generated by the NameGenerator.
        let tempFlagsStack: TempFlags[]; // Stack of enclosing name generation scopes.
        let tempFlags: TempFlags; // TempFlags for the current name generation scope.
        let reservedNamesStack: Set<string>[]; // Stack of TempFlags reserved in enclosing name generation scopes.
        let reservedNames: Set<string>; // TempFlags to reserve in nested name generation scopes.
        let preserveSourceNewlines = printerOptions.preserveSourceNewlines; // Can be overridden inside nodes with the `IgnoreSourceNewlines` emit flag.
        let nextListElementPos: number | undefined; // See comment in `getLeadingLineTerminatorCount`.

        let writer: EmitTextWriter;
        let qjsWriter: EmitTextWriter | undefined;
        const checker: TypeChecker | undefined = (!!printerOptions.emitQJSCode || !!printerOptions.emitQJSIR) ?
                            (!!getTypeChecker ? getTypeChecker() : undefined) : undefined;
        //let checker: TypeChecker | undefined;
        let ownWriter: EmitTextWriter; // Reusable `EmitTextWriter` for basic printing.
        let write = writeBase;
        let isOwnFileEmit: boolean;
        const bundleFileInfo = printerOptions.writeBundleFileInfo ? { sections: [] } as BundleFileInfo : undefined;
        const relativeToBuildInfo = bundleFileInfo ? Debug.checkDefined(printerOptions.relativeToBuildInfo) : undefined;
        const recordInternalSection = printerOptions.recordInternalSection;
        let sourceFileTextPos = 0;
        let sourceFileTextKind: BundleFileTextLikeKind = BundleFileSectionKind.Text;

        // Source Maps
        let sourceMapsDisabled = true;
        let sourceMapGenerator: SourceMapGenerator | undefined;
        let sourceMapSource: SourceMapSource;
        let sourceMapSourceIndex = -1;
        let mostRecentlyAddedSourceMapSource: SourceMapSource;
        let mostRecentlyAddedSourceMapSourceIndex = -1;

        // Comments
        let containerPos = -1;
        let containerEnd = -1;
        let declarationListContainerEnd = -1;
        let currentLineMap: readonly number[] | undefined;
        let detachedCommentsInfo: { nodePos: number, detachedCommentEndPos: number }[] | undefined;
        let hasWrittenComment = false;
        let commentsDisabled = !!printerOptions.removeComments;
        let lastSubstitution: Node | undefined;
        let currentParenthesizerRule: ((node: Node) => Node) | undefined;
        const { enter: enterComment, exit: exitComment } = performance.createTimerIf(extendedDiagnostics, "commentTime", "beforeComment", "afterComment");
        const parenthesizer = factory.parenthesizer;
        const typeArgumentParenthesizerRuleSelector: OrdinalParentheizerRuleSelector<Node> = {
            select: index => index === 0 ? parenthesizer.parenthesizeLeadingTypeArgument : undefined
        };
        const emitBinaryExpression = createEmitBinaryExpression();

        // for qjs emitter
        const enum QJSCType {
            Void = 0,
            JSAtom,
            JSValue,
            IntLiteral,
            FloatLiteral,
            StringLiteral,
            Tag,
            Int,
            Double,
            Number,
            Bool,
            ClosureVar,
            JSModuleDef,
        }

         //type QJSTypeInfo = {type: string, prefix: string};
         const qjsTypeInfo = [
            {type: "void", prefix: ""},
            {type: "JSAtom", prefix: "atom_"},
            {type: "JSValue", prefix: "jv_"},
            {type: "int", prefix: "n_"},
            {type: "double", prefix: "f_"},
            {type: "JSString", prefix: "str_"},
            {type: "int", prefix: "tag_"},
            {type: "int", prefix: "n_"},
            {type: "double", prefix: "f_"},
            {type: "double", prefix: "f_"},
            {type: "BOOL", prefix: "b_"},
            {type: "JSClosureVar", prefix: "cv_"},
            {type: "JSModuleDef", prefix: "md_"},
        ];

        const enum QJSJSType {
            Null = 0,
            Undefined,
            Uninitialized,
            NumLiteral,
            Bool,
            Int32,
            Float64,
            RefType,
            StringLiteral,
            String,
            Object,
            Function,
            Pointer,
            Any,
            Unknown,
        }

        const enum QJSValueStackState {
            None = -1,
            LValue = 0,
            RValue = 1,
        }

        /*
        const enum QJSEmitterState {
            None = 0,
            FuncBody = 1,
            BlockBody = 2,
        }
        */
        const enum QJSJSVarKind {
            Literal = 0,
            LocalVar,
            GlobalVar,
            ModuleVar,
            Arg,
            Prop,
            ArrayElement,
        }

        interface QJSJSVar {
            name: string,
            index: number, // index in stackframe
            type: QJSJSType,
            kind: QJSJSVarKind,
            outer: QJSJSVar | undefined,
            inited: boolean,
            needsync: boolean,
            cvar: QJSVar,
            uses: QJSJSVar[],
            frame: QJSFrame,
            value: string | undefined,
            flags: QJSJSVarFlags,
        }

        enum QJSJSVarFlags {
            isJSCFunction = 1 << 0,
        }

        enum QJSVarFlags {

        }

        interface QJSVar {
            frame: QJSFrame | undefined,
            type: QJSCType,
            name: string,
            value: string | undefined,
            needfree: boolean,
            flags: QJSVarFlags,
            jstype: QJSJSType, // for JSValue temp var
            jsvar: QJSJSVar | undefined,
            define: QJSVar | undefined,
            use: QJSJSVar | undefined,
        }

        interface QJSFrame {
            id: string, // for debug use.
            in: QJSFrame[],
            children: QJSFrame[],
            container: Node,
            function: Node,
            preframe: QJSFrame | undefined,
            needEmitReturn: boolean,
            vars: QJSVar[],
            jsvarmap: ESMap<string, QJSJSVar>,
            phinodes: QJSPhiNode[];
        }

        interface QJSEmitterConfig {
            emitUnboxNumVar: boolean,
            enableConstantFolding: boolean,
            enableOneArgumentFunctionCall: boolean,
            enableLazyWriteBack: boolean, // a good alias analysis is needed if enable this option.
            enableLazyInitMethod: boolean,
            useCPlusPlus: boolean,
        }

        const enum QJSBlockType {
            SourceFile = 0,
            FuncBody,
            NormalBlock,
            IfThen,
            IfElse,
            Loop,
            Try,
            Catch,
            Finally,
        }

        const enum QJSPhiKind {
            IfPhi = 0,
            LoopPhi,
        }

        interface QJSPhiNode {
            kind: QJSPhiKind;
        }
        interface QJSIfPhiNode extends QJSPhiNode {
            thenVars: ESMap<string, QJSJSVar>,
            elseVars: ESMap<string, QJSJSVar>,
            originVars: ESMap<string, QJSJSVar>,
        }

        interface QJSLoopPhiNode extends QJSPhiNode {
            loopVars: ESMap<string, QJSJSVar>,
        }
/*
        interface QJSOperator {

        }

        interface QJSIR {
            Op: QJSOperator,
            ret: QJSVar | undefined,
            opnd1: QJSVar,
            opnd2: QJSVar | undefined,
            opnd3: QJSVar | undefined,
        }
*/
        /* this stacks contains all locals and temp qjs vars.
        so that we can free them when exit current frame/container */
        let qjsCallFrames: QJSFrame[];
        //let qjsCurFrame: QJSFrame | undefined;
        let qjsCurBlockType: QJSBlockType;

        //let qjsEndFrame: QJSFrame | undefined;

        //let qjsJSVarMap: ESMap<string, QJSJSVar>;
        let qjsEmitterState: QJSValueStackState = QJSValueStackState.None;
        /* I intent to seperate value stack from container stack for making things clear. */
        let qjsValueStack: QJSVar[];
        /* symbol name management in C language */
        let qjsGeneratedNames: Set<string>;
        let qjsReservedScopeNames: Set<string>;
        let qjsReservedNameStack: Set<string>[];

        let qjsConfig: QJSEmitterConfig;

        let qjsAtomMap: ESMap<string, QJSVar>;
        let qjsInitFuncName: string;

        // use to record all function decl, and paste them on the top of the file.
        // currently just record the decl string. if neccesary, we can record
        // the relationship between these functions, like parent, sibling, child etc.
        let qjsFuncDecls: string[];
        let qjsPauseJSEmit = false;

        const enum QJSEvalType {
            Global = 0,
            Module,
        }

        let qjsEvalType: QJSEvalType;

        const enum QJSReserved {
            DefaultObject = "Object",
            DefaultCtx = "ctx",
            DefaultThisVal = "this_val",
            DefaultArgc = "argc",
            DefaultArgv = "argv",
            DefaultEntryFunc = "js_eval_entry",
            NULL = "NULL",
            If = "if",
            True = "TRUE",
            False = "FALSE",
            While = "while",
            Break = "break",
            Return = "return",
            Static = "static",
            Try = "try",
            Catch = "catch",
            Finally = "finally",
            Throw = "throw",
            JSUndefined = "JS_UNDEFINED",
            JSUninitialized = "JS_UNINITIALIZED",
            IntInitVal = "0",
            DoubleInitVal = "0.0",
            QJSTempVarName = "temp",
            FileFuncPrefix = "js_eval_file_",
            FuncPrefix = "js_func_",
            InitModulePrefix = "js_init_module_",
            InitAtomTableFunc = "js_init_atom_table",
            FreeAtomTableFunc = "js_free_atom_table",
            DefaultFuncCtxParam = "JSContext *ctx",
            DefaultFuncParams = "(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)",
            DefaultModuleFuncParams = "(JSContext *ctx, JSModuleDef *m)",
            LTToken = "<",
            LTEToken = "<=",
            EqualsEqualsToken = "==",
            JS_TAG_BOOL = "JS_TAG_BOOL",
            JS_TAG_INT = "JS_TAG_INT",
            JS_TAG_FLOAT64 = "JS_TAG_FLOAT64",
            JS_TAG_UNINITIALIZED = "JS_TAG_UNINITIALIZED",
            CV_IS_LOCAL = "is_local",
            CV_IS_ARG = "is_arg",
            CV_IS_LEXICAL = "is_lexical",
            CV_VAR_INDEX = "var_idx",
            CV_VAR_NAME = "var_name",
            JS_CFUNC_constructor = "JS_CFUNC_constructor",
        }

        const enum QJSFunction {
            JS_NewAtom = "JS_NewAtom",
            JS_FreeAtom = "JS_FreeAtom",
            JS_FreeValue = "JS_FreeValue",
            JS_GetPropertyValue = "JS_GetPropertyValue",
            JS_DefineGlobalVar = "JS_DefineGlobalVar",
            JS_DefinePropertyValue = "JS_DefinePropertyValue",
            JS_SetPropertyInternal = "JS_SetPropertyInternal",
            JS_GetPropertyInternal = "JS_GetPropertyInternal",
            JS_GetPropertyUint32 = "JS_GetPropertyUint32",
            JS_GetElementValue = "JS_GetElementValue",
            JS_SetPropertyValue = "JS_SetPropertyValue",
            JS_SetPropertyUint32 = "JS_SetPropertyUint32",
            JS_SetPropertyInt64 = "JS_SetPropertyInt64",
            JS_GetGlobalVar = "JS_GetGlobalVar",
            JS_SetGlobalVar = "JS_SetGlobalVar",
            JS_SetAndGetModuleExportVarRefByIndex = "JS_SetAndGetModuleExportVarRefByIndex",
            JS_GetVarRefFromModuleExport = "JS_GetVarRefFromModuleExport",
            JS_CreateModuleVar = "js_create_module_var",
            JS_NewInt32 = "JS_NewInt32",
            JS_NewFloat64 = "JS_NewFloat64",
            JS_NewCFunction = "JS_NewCFunction",
            JS_NewCFunction2 = "JS_NewCFunction2",
            JS_NewObject = "JS_NewObject",
            JS_NewArray = "JS_NewArray",
            JS_NewString = "JS_NewString",
            JS_AddModuleExportByAtom = "JS_AddModuleExportByAtom",
            JS_AddModuleImportByAtom = "JS_AddModuleImportByAtom",
            JS_DefineClass = "js_define_class",
            JS_AddReqModule = "add_req_module_entry",
            JS_ConcatString = "JS_ConcatString",
            JS_DefineGlobalFunction = "JS_DefineGlobalFunction",
            JS_SetValue = "set_value",
            JS_DupValue = "JS_DupValue",
            JS_Call_jsc = "JS_Call_jsc",
            JS_Call_jsc_function = "js_call_jsc_function",
            JS_CALL_C_FUNCTION = "js_call_c_function",
            JS_Call = "JS_Call",
            JS_CallConstructor = "JS_CallConstructor",
            JS_ToBool = "JS_ToBool",
            JS_VALUE_GET_BOOL = "JS_VALUE_GET_BOOL",
            JS_VALUE_GET_INT = "JS_VALUE_GET_INT",
            JS_VALUE_GET_FLOAT64 = "JS_VALUE_GET_FLOAT64",
            JS_MKVAL = "JS_MKVAL",
            JS_VALUE_GET_TAG = "JS_VALUE_GET_TAG",
            JS_UPDATE_SF_FUNC = "js_update_sf",
            JS_UPDATE_SF_MACRO = "JS_UPDATE_SF",
            JS_MODULE_FUNC_PROLOGUE = "JS_MODULE_FUNC_PROLOGUE",
            JS_CLOSURE_JSC = "js_closure_jsc",
            JS_COMPARE_NUMBER_INT = "jsvalue_compare_number_int",
            JS_COMPARE_NUMBER_NUMBER = "jsvalue_compare_number_number",
            JS_COMPARE_INT_NUMBER = "jsvalue_compare_int_number",
            JS_IncInt = "jsvalue_inc_int",
            JS_AddIntInt = "jsvalue_add_int_int",
            JS_AddNumberInt = "jsvalue_add_number_int",
            JS_AddIntNumber = "jsvalue_add_int_number",
            JS_AddNumberNumber = "jsvalue_add_number_number",
            JS_SubIntInt = "jsvalue_sub_int_int",
            JS_SubNumberInt = "jsvalue_sub_number_int",
            JS_SubIntNumber = "jsvalue_sub_int_number",
            JS_SubNumberNumber = "jsvalue_sub_number_number",
            JS_MulIntInt = "jsvalue_mul_int_int",
            JS_MulNumberInt = "jsvalue_mul_number_int",
            JS_MulIntNumber = "jsvalue_mul_int_number",
            JS_MulNumberNumber = "jsvalue_mul_number_number",
            JS_DivIntInt = "jsvalue_div_int_int",
            JS_DivNumberInt = "jsvalue_div_number_int",
            JS_DivIntNumber = "jsvalue_div_int_number",
            JS_DivNumberNumber = "jsvalue_div_number_number",
            JS_StrictEQ = "js_strict_eq",
            JS_For_In_Start = "js_for_in_start2",
            JS_For_In_Next = "js_for_in_next2",
        }

        reset();
        return {
            // public API
            printNode,
            printList,
            printFile,
            printBundle,

            // internal API
            writeNode,
            writeList,
            writeFile,
            writeBundle,
            bundleFileInfo
        };

        function printNode(hint: EmitHint, node: Node, sourceFile: SourceFile): string {
            switch (hint) {
                case EmitHint.SourceFile:
                    Debug.assert(isSourceFile(node), "Expected a SourceFile node.");
                    break;
                case EmitHint.IdentifierName:
                    Debug.assert(isIdentifier(node), "Expected an Identifier node.");
                    break;
                case EmitHint.Expression:
                    Debug.assert(isExpression(node), "Expected an Expression node.");
                    break;
            }
            switch (node.kind) {
                case SyntaxKind.SourceFile: return printFile(node as SourceFile);
                case SyntaxKind.Bundle: return printBundle(node as Bundle);
                case SyntaxKind.UnparsedSource: return printUnparsedSource(node as UnparsedSource);
            }
            writeNode(hint, node, sourceFile, beginPrint());
            return endPrint();
        }

        function printList<T extends Node>(format: ListFormat, nodes: NodeArray<T>, sourceFile: SourceFile) {
            writeList(format, nodes, sourceFile, beginPrint());
            return endPrint();
        }

        function printBundle(bundle: Bundle): string {
            writeBundle(bundle, beginPrint(), undefined, /*sourceMapEmitter*/ undefined);
            return endPrint();
        }

        function printFile(sourceFile: SourceFile): string {
            writeFile(sourceFile, beginPrint(), undefined, /*sourceMapEmitter*/ undefined);
            return endPrint();
        }

        function printUnparsedSource(unparsed: UnparsedSource): string {
            writeUnparsedSource(unparsed, beginPrint());
            return endPrint();
        }

        /**
         * If `sourceFile` is `undefined`, `node` must be a synthesized `TypeNode`.
         */
        function writeNode(hint: EmitHint, node: TypeNode, sourceFile: undefined, output: EmitTextWriter): void;
        function writeNode(hint: EmitHint, node: Node, sourceFile: SourceFile, output: EmitTextWriter): void;
        function writeNode(hint: EmitHint, node: Node, sourceFile: SourceFile | undefined, output: EmitTextWriter) {
            const previousWriter = writer;
            setWriter(output, /*_sourceMapGenerator*/ undefined);
            print(hint, node, sourceFile);
            reset();
            writer = previousWriter;
        }

        function writeList<T extends Node>(format: ListFormat, nodes: NodeArray<T>, sourceFile: SourceFile | undefined, output: EmitTextWriter) {
            const previousWriter = writer;
            setWriter(output, /*_sourceMapGenerator*/ undefined);
            if (sourceFile) {
                setSourceFile(sourceFile);
            }
            emitList(/*parentNode*/ undefined, nodes, format);
            reset();
            writer = previousWriter;
        }

        function getTextPosWithWriteLine() {
            return writer.getTextPosWithWriteLine ? writer.getTextPosWithWriteLine() : writer.getTextPos();
        }

        function updateOrPushBundleFileTextLike(pos: number, end: number, kind: BundleFileTextLikeKind) {
            const last = lastOrUndefined(bundleFileInfo!.sections);
            if (last && last.kind === kind) {
                last.end = end;
            }
            else {
                bundleFileInfo!.sections.push({ pos, end, kind });
            }
        }

        function recordBundleFileInternalSectionStart(node: Node) {
            if (recordInternalSection &&
                bundleFileInfo &&
                currentSourceFile &&
                (isDeclaration(node) || isVariableStatement(node)) &&
                isInternalDeclaration(node, currentSourceFile) &&
                sourceFileTextKind !== BundleFileSectionKind.Internal) {
                const prevSourceFileTextKind = sourceFileTextKind;
                recordBundleFileTextLikeSection(writer.getTextPos());
                sourceFileTextPos = getTextPosWithWriteLine();
                sourceFileTextKind = BundleFileSectionKind.Internal;
                return prevSourceFileTextKind;
            }
            return undefined;
        }

        function recordBundleFileInternalSectionEnd(prevSourceFileTextKind: ReturnType<typeof recordBundleFileInternalSectionStart>) {
            if (prevSourceFileTextKind) {
                recordBundleFileTextLikeSection(writer.getTextPos());
                sourceFileTextPos = getTextPosWithWriteLine();
                sourceFileTextKind = prevSourceFileTextKind;
            }
        }

        function recordBundleFileTextLikeSection(end: number) {
            if (sourceFileTextPos < end) {
                updateOrPushBundleFileTextLike(sourceFileTextPos, end, sourceFileTextKind);
                return true;
            }
            return false;
        }

        function writeBundle(bundle: Bundle, output: EmitTextWriter, output2: EmitTextWriter | undefined, sourceMapGenerator: SourceMapGenerator | undefined) {
            isOwnFileEmit = false;
            const previousWriter = writer;
            const previousQJSWriter = qjsWriter;
            setWriter(output, sourceMapGenerator);
            qjsWriter = output2;
            emitShebangIfNeeded(bundle);
            emitPrologueDirectivesIfNeeded(bundle);
            emitHelpers(bundle);
            emitSyntheticTripleSlashReferencesIfNeeded(bundle);

            for (const prepend of bundle.prepends) {
                writeLine();
                const pos = writer.getTextPos();
                const savedSections = bundleFileInfo && bundleFileInfo.sections;
                if (savedSections) bundleFileInfo.sections = [];
                print(EmitHint.Unspecified, prepend, /*sourceFile*/ undefined);
                if (bundleFileInfo) {
                    const newSections = bundleFileInfo.sections;
                    bundleFileInfo.sections = savedSections!;
                    if (prepend.oldFileOfCurrentEmit) bundleFileInfo.sections.push(...newSections);
                    else {
                        newSections.forEach(section => Debug.assert(isBundleFileTextLike(section)));
                        bundleFileInfo.sections.push({
                            pos,
                            end: writer.getTextPos(),
                            kind: BundleFileSectionKind.Prepend,
                            data: relativeToBuildInfo!((prepend as UnparsedSource).fileName),
                            texts: newSections as BundleFileTextLike[]
                        });
                    }
                }
            }

            sourceFileTextPos = getTextPosWithWriteLine();
            for (const sourceFile of bundle.sourceFiles) {
                print(EmitHint.SourceFile, sourceFile, sourceFile);
            }
            if (bundleFileInfo && bundle.sourceFiles.length) {
                const end = writer.getTextPos();
                if (recordBundleFileTextLikeSection(end)) {
                    // Store prologues
                    const prologues = getPrologueDirectivesFromBundledSourceFiles(bundle);
                    if (prologues) {
                        if (!bundleFileInfo.sources) bundleFileInfo.sources = {};
                        bundleFileInfo.sources.prologues = prologues;
                    }

                    // Store helpes
                    const helpers = getHelpersFromBundledSourceFiles(bundle);
                    if (helpers) {
                        if (!bundleFileInfo.sources) bundleFileInfo.sources = {};
                        bundleFileInfo.sources.helpers = helpers;
                    }
                }
            }

            reset();
            writer = previousWriter;
            qjsWriter = previousQJSWriter;
        }

        function writeUnparsedSource(unparsed: UnparsedSource, output: EmitTextWriter) {
            const previousWriter = writer;
            setWriter(output, /*_sourceMapGenerator*/ undefined);
            print(EmitHint.Unspecified, unparsed, /*sourceFile*/ undefined);
            reset();
            writer = previousWriter;
        }

        function writeFile(sourceFile: SourceFile, output: EmitTextWriter, output2: EmitTextWriter | undefined, sourceMapGenerator: SourceMapGenerator | undefined) {
            isOwnFileEmit = true;
            const previousWriter = writer;
            const previousQjsWriter = qjsWriter;
            setWriter(output, sourceMapGenerator);
            qjsWriter = output2;
            emitShebangIfNeeded(sourceFile);
            emitPrologueDirectivesIfNeeded(sourceFile);
            print(EmitHint.SourceFile, sourceFile, sourceFile);
            reset();
            writer = previousWriter;
            qjsWriter = previousQjsWriter;
        }

        function beginPrint() {
            return ownWriter || (ownWriter = createTextWriter(newLine));
        }

        function endPrint() {
            const text = ownWriter.getText();
            ownWriter.clear();
            return text;
        }

        function print(hint: EmitHint, node: Node, sourceFile: SourceFile | undefined) {
            if (sourceFile) {
                setSourceFile(sourceFile);
            }

            pipelineEmit(hint, node, /*parenthesizerRule*/ undefined);
        }

        function setSourceFile(sourceFile: SourceFile | undefined) {
            currentSourceFile = sourceFile;
            currentLineMap = undefined;
            detachedCommentsInfo = undefined;
            if (sourceFile) {
                setSourceMapSource(sourceFile);
            }
        }

        function setWriter(_writer: EmitTextWriter | undefined, _sourceMapGenerator: SourceMapGenerator | undefined) {
            if (_writer && printerOptions.omitTrailingSemicolon) {
                _writer = getTrailingSemicolonDeferringWriter(_writer);
            }

            writer = _writer!; // TODO: GH#18217
            sourceMapGenerator = _sourceMapGenerator;
            sourceMapsDisabled = !writer || !sourceMapGenerator;
        }

        function reset() {
            nodeIdToGeneratedName = [];
            autoGeneratedIdToGeneratedName = [];
            generatedNames = new Set();
            tempFlagsStack = [];
            tempFlags = TempFlags.Auto;
            reservedNamesStack = [];
            currentSourceFile = undefined;
            currentLineMap = undefined;
            detachedCommentsInfo = undefined;
            setWriter(/*output*/ undefined, /*_sourceMapGenerator*/ undefined);

            // for qjs emitter
            qjsWriter = undefined;
            qjsCallFrames = [];
            //qjsCurFrame = undefined;
            qjsCurBlockType = QJSBlockType.SourceFile;
            //qjsEndFrame = undefined;

            qjsValueStack = [];
            qjsGeneratedNames = new Set();
            qjsReservedNameStack = [];
            qjsConfig = {
                emitUnboxNumVar: false,
                enableConstantFolding: true,
                enableOneArgumentFunctionCall: false,
                enableLazyWriteBack: false,
                enableLazyInitMethod: false,
                useCPlusPlus: true,
            };
            qjsAtomMap = new Map<string, QJSVar>();
            qjsInitFuncName = "";
            qjsEvalType = QJSEvalType.Global;
            qjsFuncDecls = [];
        }

        function getCurrentLineMap() {
            return currentLineMap || (currentLineMap = getLineStarts(currentSourceFile!));
        }

        function emit(node: Node, parenthesizerRule?: (node: Node) => Node): void;
        function emit(node: Node | undefined, parenthesizerRule?: (node: Node) => Node): void;
        function emit(node: Node | undefined, parenthesizerRule?: (node: Node) => Node) {
            if (node === undefined) return;
            const prevSourceFileTextKind = recordBundleFileInternalSectionStart(node);
            pipelineEmit(EmitHint.Unspecified, node, parenthesizerRule);
            recordBundleFileInternalSectionEnd(prevSourceFileTextKind);
        }

        function emitIdentifierName(node: Identifier): void;
        function emitIdentifierName(node: Identifier | undefined): void;
        function emitIdentifierName(node: Identifier | undefined) {
            if (node === undefined) return;
            pipelineEmit(EmitHint.IdentifierName, node, /*parenthesizerRule*/ undefined);
        }

        function emitExpression(node: Expression, parenthesizerRule?: (node: Expression) => Expression): void;
        function emitExpression(node: Expression | undefined, parenthesizerRule?: (node: Expression) => Expression): void;
        function emitExpression(node: Expression | undefined, parenthesizerRule?: (node: Expression) => Expression) {
            if (node === undefined) return;
            pipelineEmit(EmitHint.Expression, node, parenthesizerRule);
        }

        function emitJsxAttributeValue(node: StringLiteral | JsxExpression): void {
            pipelineEmit(isStringLiteral(node) ? EmitHint.JsxAttributeValue : EmitHint.Unspecified, node);
        }

        function beforeEmitNode(node: Node) {
            if (preserveSourceNewlines && (getEmitFlags(node) & EmitFlags.IgnoreSourceNewlines)) {
                preserveSourceNewlines = false;
            }
        }

        function afterEmitNode(savedPreserveSourceNewlines: boolean | undefined) {
            preserveSourceNewlines = savedPreserveSourceNewlines;
        }

        function pipelineEmit(emitHint: EmitHint, node: Node, parenthesizerRule?: (node: Node) => Node) {
            currentParenthesizerRule = parenthesizerRule;
            const pipelinePhase = getPipelinePhase(PipelinePhase.Notification, emitHint, node);
            pipelinePhase(emitHint, node);
            currentParenthesizerRule = undefined;
        }

        function shouldEmitComments(node: Node) {
            return !commentsDisabled && !isSourceFile(node);
        }

        function shouldEmitSourceMaps(node: Node) {
            return !sourceMapsDisabled &&
                !isSourceFile(node) &&
                !isInJsonFile(node) &&
                !isUnparsedSource(node) &&
                !isUnparsedPrepend(node);
        }

        function getPipelinePhase(phase: PipelinePhase, emitHint: EmitHint, node: Node) {
            switch (phase) {
                case PipelinePhase.Notification:
                    if (onEmitNode !== noEmitNotification && (!isEmitNotificationEnabled || isEmitNotificationEnabled(node))) {
                        return pipelineEmitWithNotification;
                    }
                    // falls through
                case PipelinePhase.Substitution:
                    if (substituteNode !== noEmitSubstitution && (lastSubstitution = substituteNode(emitHint, node) || node) !== node) {
                        if (currentParenthesizerRule) {
                            lastSubstitution = currentParenthesizerRule(lastSubstitution);
                        }
                        return pipelineEmitWithSubstitution;
                    }
                    // falls through
                case PipelinePhase.Comments:
                    if (shouldEmitComments(node)) {
                        return pipelineEmitWithComments;
                    }
                    // falls through
                case PipelinePhase.SourceMaps:
                    if (shouldEmitSourceMaps(node)) {
                        return pipelineEmitWithSourceMaps;
                    }
                    // falls through
                case PipelinePhase.Emit:
                    return pipelineEmitWithHint;
                default:
                    return Debug.assertNever(phase);
            }
        }

        function getNextPipelinePhase(currentPhase: PipelinePhase, emitHint: EmitHint, node: Node) {
            return getPipelinePhase(currentPhase + 1, emitHint, node);
        }

        function pipelineEmitWithNotification(hint: EmitHint, node: Node) {
            const pipelinePhase = getNextPipelinePhase(PipelinePhase.Notification, hint, node);
            onEmitNode(hint, node, pipelinePhase);
        }

        function pipelineEmitWithHint(hint: EmitHint, node: Node): void {
            onBeforeEmitNode?.(node);
            if (preserveSourceNewlines) {
                const savedPreserveSourceNewlines = preserveSourceNewlines;
                beforeEmitNode(node);
                pipelineEmitWithHintWorker(hint, node);
                afterEmitNode(savedPreserveSourceNewlines);
            }
            else {
                pipelineEmitWithHintWorker(hint, node);
            }
            onAfterEmitNode?.(node);
            // clear the parenthesizer rule as we ascend
            currentParenthesizerRule = undefined;
        }

        function pipelineEmitWithHintWorker(hint: EmitHint, node: Node, allowSnippets = true): void {
            if (allowSnippets) {
                const snippet = getSnippetElement(node);
                if (snippet) {
                    return emitSnippetNode(hint, node, snippet);
                }
            }
            if (hint === EmitHint.SourceFile) return emitSourceFile(cast(node, isSourceFile));
            if (hint === EmitHint.IdentifierName) return emitIdentifier(cast(node, isIdentifier));
            if (hint === EmitHint.JsxAttributeValue) return emitLiteral(cast(node, isStringLiteral), /*jsxAttributeEscape*/ true);
            if (hint === EmitHint.MappedTypeParameter) return emitMappedTypeParameter(cast(node, isTypeParameterDeclaration));
            if (hint === EmitHint.EmbeddedStatement) {
                Debug.assertNode(node, isEmptyStatement);
                return emitEmptyStatement(/*isEmbeddedStatement*/ true);
            }
            if (hint === EmitHint.Unspecified) {
                switch (node.kind) {
                    // Pseudo-literals
                    case SyntaxKind.TemplateHead:
                    case SyntaxKind.TemplateMiddle:
                    case SyntaxKind.TemplateTail:
                        return emitLiteral(node as LiteralExpression, /*jsxAttributeEscape*/ false);

                    // Identifiers
                    case SyntaxKind.Identifier:
                        return emitIdentifier(node as Identifier);

                    // PrivateIdentifiers
                    case SyntaxKind.PrivateIdentifier:
                        return emitPrivateIdentifier(node as PrivateIdentifier);

                    // Parse tree nodes
                    // Names
                    case SyntaxKind.QualifiedName:
                        return emitQualifiedName(node as QualifiedName);
                    case SyntaxKind.ComputedPropertyName:
                        return emitComputedPropertyName(node as ComputedPropertyName);

                    // Signature elements
                    case SyntaxKind.TypeParameter:
                        return emitTypeParameter(node as TypeParameterDeclaration);
                    case SyntaxKind.Parameter:
                        return emitParameter(node as ParameterDeclaration);
                    case SyntaxKind.Decorator:
                        return emitDecorator(node as Decorator);

                    // Type members
                    case SyntaxKind.PropertySignature:
                        return emitPropertySignature(node as PropertySignature);
                    case SyntaxKind.PropertyDeclaration:
                        return emitPropertyDeclaration(node as PropertyDeclaration);
                    case SyntaxKind.MethodSignature:
                        return emitMethodSignature(node as MethodSignature);
                    case SyntaxKind.MethodDeclaration:
                        return emitMethodDeclaration(node as MethodDeclaration);
                    case SyntaxKind.ClassStaticBlockDeclaration:
                        return emitClassStaticBlockDeclaration(node as ClassStaticBlockDeclaration);
                    case SyntaxKind.Constructor:
                        return emitConstructor(node as ConstructorDeclaration);
                    case SyntaxKind.GetAccessor:
                    case SyntaxKind.SetAccessor:
                        return emitAccessorDeclaration(node as AccessorDeclaration);
                    case SyntaxKind.CallSignature:
                        return emitCallSignature(node as CallSignatureDeclaration);
                    case SyntaxKind.ConstructSignature:
                        return emitConstructSignature(node as ConstructSignatureDeclaration);
                    case SyntaxKind.IndexSignature:
                        return emitIndexSignature(node as IndexSignatureDeclaration);

                    // Types
                    case SyntaxKind.TypePredicate:
                        return emitTypePredicate(node as TypePredicateNode);
                    case SyntaxKind.TypeReference:
                        return emitTypeReference(node as TypeReferenceNode);
                    case SyntaxKind.FunctionType:
                        return emitFunctionType(node as FunctionTypeNode);
                    case SyntaxKind.ConstructorType:
                        return emitConstructorType(node as ConstructorTypeNode);
                    case SyntaxKind.TypeQuery:
                        return emitTypeQuery(node as TypeQueryNode);
                    case SyntaxKind.TypeLiteral:
                        return emitTypeLiteral(node as TypeLiteralNode);
                    case SyntaxKind.ArrayType:
                        return emitArrayType(node as ArrayTypeNode);
                    case SyntaxKind.TupleType:
                        return emitTupleType(node as TupleTypeNode);
                    case SyntaxKind.OptionalType:
                        return emitOptionalType(node as OptionalTypeNode);
                    // SyntaxKind.RestType is handled below
                    case SyntaxKind.UnionType:
                        return emitUnionType(node as UnionTypeNode);
                    case SyntaxKind.IntersectionType:
                        return emitIntersectionType(node as IntersectionTypeNode);
                    case SyntaxKind.ConditionalType:
                        return emitConditionalType(node as ConditionalTypeNode);
                    case SyntaxKind.InferType:
                        return emitInferType(node as InferTypeNode);
                    case SyntaxKind.ParenthesizedType:
                        return emitParenthesizedType(node as ParenthesizedTypeNode);
                    case SyntaxKind.ExpressionWithTypeArguments:
                        return emitExpressionWithTypeArguments(node as ExpressionWithTypeArguments);
                    case SyntaxKind.ThisType:
                        return emitThisType();
                    case SyntaxKind.TypeOperator:
                        return emitTypeOperator(node as TypeOperatorNode);
                    case SyntaxKind.IndexedAccessType:
                        return emitIndexedAccessType(node as IndexedAccessTypeNode);
                    case SyntaxKind.MappedType:
                        return emitMappedType(node as MappedTypeNode);
                    case SyntaxKind.LiteralType:
                        return emitLiteralType(node as LiteralTypeNode);
                    case SyntaxKind.NamedTupleMember:
                        return emitNamedTupleMember(node as NamedTupleMember);
                    case SyntaxKind.TemplateLiteralType:
                        return emitTemplateType(node as TemplateLiteralTypeNode);
                    case SyntaxKind.TemplateLiteralTypeSpan:
                        return emitTemplateTypeSpan(node as TemplateLiteralTypeSpan);
                    case SyntaxKind.ImportType:
                        return emitImportTypeNode(node as ImportTypeNode);

                    // Binding patterns
                    case SyntaxKind.ObjectBindingPattern:
                        return emitObjectBindingPattern(node as ObjectBindingPattern);
                    case SyntaxKind.ArrayBindingPattern:
                        return emitArrayBindingPattern(node as ArrayBindingPattern);
                    case SyntaxKind.BindingElement:
                        return emitBindingElement(node as BindingElement);

                    // Misc
                    case SyntaxKind.TemplateSpan:
                        return emitTemplateSpan(node as TemplateSpan);
                    case SyntaxKind.SemicolonClassElement:
                        return emitSemicolonClassElement();

                    // Statements
                    case SyntaxKind.Block:
                        return emitBlock(node as Block);
                    case SyntaxKind.VariableStatement:
                        return emitVariableStatement(node as VariableStatement);
                    case SyntaxKind.EmptyStatement:
                        return emitEmptyStatement(/*isEmbeddedStatement*/ false);
                    case SyntaxKind.ExpressionStatement:
                        return emitExpressionStatement(node as ExpressionStatement);
                    case SyntaxKind.IfStatement:
                        return emitIfStatement(node as IfStatement);
                    case SyntaxKind.DoStatement:
                        return emitDoStatement(node as DoStatement);
                    case SyntaxKind.WhileStatement:
                        return emitWhileStatement(node as WhileStatement);
                    case SyntaxKind.ForStatement:
                        return emitForStatement(node as ForStatement);
                    case SyntaxKind.ForInStatement:
                        return emitForInStatement(node as ForInStatement);
                    case SyntaxKind.ForOfStatement:
                        return emitForOfStatement(node as ForOfStatement);
                    case SyntaxKind.ContinueStatement:
                        return emitContinueStatement(node as ContinueStatement);
                    case SyntaxKind.BreakStatement:
                        return emitBreakStatement(node as BreakStatement);
                    case SyntaxKind.ReturnStatement:
                        return emitReturnStatement(node as ReturnStatement);
                    case SyntaxKind.WithStatement:
                        return emitWithStatement(node as WithStatement);
                    case SyntaxKind.SwitchStatement:
                        return emitSwitchStatement(node as SwitchStatement);
                    case SyntaxKind.LabeledStatement:
                        return emitLabeledStatement(node as LabeledStatement);
                    case SyntaxKind.ThrowStatement:
                        return emitThrowStatement(node as ThrowStatement);
                    case SyntaxKind.TryStatement:
                        return emitTryStatement(node as TryStatement);
                    case SyntaxKind.DebuggerStatement:
                        return emitDebuggerStatement(node as DebuggerStatement);

                    // Declarations
                    case SyntaxKind.VariableDeclaration:
                        return emitVariableDeclaration(node as VariableDeclaration);
                    case SyntaxKind.VariableDeclarationList:
                        return emitVariableDeclarationList(node as VariableDeclarationList);
                    case SyntaxKind.FunctionDeclaration:
                        return emitFunctionDeclaration(node as FunctionDeclaration);
                    case SyntaxKind.ClassDeclaration:
                        return emitClassDeclaration(node as ClassDeclaration);
                    case SyntaxKind.InterfaceDeclaration:
                        return emitInterfaceDeclaration(node as InterfaceDeclaration);
                    case SyntaxKind.TypeAliasDeclaration:
                        return emitTypeAliasDeclaration(node as TypeAliasDeclaration);
                    case SyntaxKind.EnumDeclaration:
                        return emitEnumDeclaration(node as EnumDeclaration);
                    case SyntaxKind.ModuleDeclaration:
                        return emitModuleDeclaration(node as ModuleDeclaration);
                    case SyntaxKind.ModuleBlock:
                        return emitModuleBlock(node as ModuleBlock);
                    case SyntaxKind.CaseBlock:
                        return emitCaseBlock(node as CaseBlock);
                    case SyntaxKind.NamespaceExportDeclaration:
                        return emitNamespaceExportDeclaration(node as NamespaceExportDeclaration);
                    case SyntaxKind.ImportEqualsDeclaration:
                        return emitImportEqualsDeclaration(node as ImportEqualsDeclaration);
                    case SyntaxKind.ImportDeclaration:
                        return emitImportDeclaration(node as ImportDeclaration);
                    case SyntaxKind.ImportClause:
                        return emitImportClause(node as ImportClause);
                    case SyntaxKind.NamespaceImport:
                        return emitNamespaceImport(node as NamespaceImport);
                    case SyntaxKind.NamespaceExport:
                        return emitNamespaceExport(node as NamespaceExport);
                    case SyntaxKind.NamedImports:
                        return emitNamedImports(node as NamedImports);
                    case SyntaxKind.ImportSpecifier:
                        return emitImportSpecifier(node as ImportSpecifier);
                    case SyntaxKind.ExportAssignment:
                        return emitExportAssignment(node as ExportAssignment);
                    case SyntaxKind.ExportDeclaration:
                        return emitExportDeclaration(node as ExportDeclaration);
                    case SyntaxKind.NamedExports:
                        return emitNamedExports(node as NamedExports);
                    case SyntaxKind.ExportSpecifier:
                        return emitExportSpecifier(node as ExportSpecifier);
                    case SyntaxKind.AssertClause:
                        return emitAssertClause(node as AssertClause);
                    case SyntaxKind.AssertEntry:
                        return emitAssertEntry(node as AssertEntry);
                    case SyntaxKind.MissingDeclaration:
                        return;

                    // Module references
                    case SyntaxKind.ExternalModuleReference:
                        return emitExternalModuleReference(node as ExternalModuleReference);

                    // JSX (non-expression)
                    case SyntaxKind.JsxText:
                        return emitJsxText(node as JsxText);
                    case SyntaxKind.JsxOpeningElement:
                    case SyntaxKind.JsxOpeningFragment:
                        return emitJsxOpeningElementOrFragment(node as JsxOpeningElement);
                    case SyntaxKind.JsxClosingElement:
                    case SyntaxKind.JsxClosingFragment:
                        return emitJsxClosingElementOrFragment(node as JsxClosingElement);
                    case SyntaxKind.JsxAttribute:
                        return emitJsxAttribute(node as JsxAttribute);
                    case SyntaxKind.JsxAttributes:
                        return emitJsxAttributes(node as JsxAttributes);
                    case SyntaxKind.JsxSpreadAttribute:
                        return emitJsxSpreadAttribute(node as JsxSpreadAttribute);
                    case SyntaxKind.JsxExpression:
                        return emitJsxExpression(node as JsxExpression);

                    // Clauses
                    case SyntaxKind.CaseClause:
                        return emitCaseClause(node as CaseClause);
                    case SyntaxKind.DefaultClause:
                        return emitDefaultClause(node as DefaultClause);
                    case SyntaxKind.HeritageClause:
                        return emitHeritageClause(node as HeritageClause);
                    case SyntaxKind.CatchClause:
                        return emitCatchClause(node as CatchClause);

                    // Property assignments
                    case SyntaxKind.PropertyAssignment:
                        return emitPropertyAssignment(node as PropertyAssignment);
                    case SyntaxKind.ShorthandPropertyAssignment:
                        return emitShorthandPropertyAssignment(node as ShorthandPropertyAssignment);
                    case SyntaxKind.SpreadAssignment:
                        return emitSpreadAssignment(node as SpreadAssignment);

                    // Enum
                    case SyntaxKind.EnumMember:
                        return emitEnumMember(node as EnumMember);

                    // Unparsed
                    case SyntaxKind.UnparsedPrologue:
                        return writeUnparsedNode(node as UnparsedNode);
                    case SyntaxKind.UnparsedSource:
                    case SyntaxKind.UnparsedPrepend:
                        return emitUnparsedSourceOrPrepend(node as UnparsedSource);
                    case SyntaxKind.UnparsedText:
                    case SyntaxKind.UnparsedInternalText:
                        return emitUnparsedTextLike(node as UnparsedTextLike);
                    case SyntaxKind.UnparsedSyntheticReference:
                        return emitUnparsedSyntheticReference(node as UnparsedSyntheticReference);

                    // Top-level nodes
                    case SyntaxKind.SourceFile:
                        return emitSourceFile(node as SourceFile);
                    case SyntaxKind.Bundle:
                        return Debug.fail("Bundles should be printed using printBundle");
                    // SyntaxKind.UnparsedSource (handled above)
                    case SyntaxKind.InputFiles:
                        return Debug.fail("InputFiles should not be printed");

                    // JSDoc nodes (only used in codefixes currently)
                    case SyntaxKind.JSDocTypeExpression:
                        return emitJSDocTypeExpression(node as JSDocTypeExpression);
                    case SyntaxKind.JSDocNameReference:
                        return emitJSDocNameReference(node as JSDocNameReference);
                    case SyntaxKind.JSDocAllType:
                        return writePunctuation("*");
                    case SyntaxKind.JSDocUnknownType:
                        return writePunctuation("?");
                    case SyntaxKind.JSDocNullableType:
                        return emitJSDocNullableType(node as JSDocNullableType);
                    case SyntaxKind.JSDocNonNullableType:
                        return emitJSDocNonNullableType(node as JSDocNonNullableType);
                    case SyntaxKind.JSDocOptionalType:
                        return emitJSDocOptionalType(node as JSDocOptionalType);
                    case SyntaxKind.JSDocFunctionType:
                        return emitJSDocFunctionType(node as JSDocFunctionType);
                    case SyntaxKind.RestType:
                    case SyntaxKind.JSDocVariadicType:
                        return emitRestOrJSDocVariadicType(node as RestTypeNode | JSDocVariadicType);
                    case SyntaxKind.JSDocNamepathType:
                        return;
                    case SyntaxKind.JSDoc:
                        return emitJSDoc(node as JSDoc);
                    case SyntaxKind.JSDocTypeLiteral:
                        return emitJSDocTypeLiteral(node as JSDocTypeLiteral);
                    case SyntaxKind.JSDocSignature:
                        return emitJSDocSignature(node as JSDocSignature);
                    case SyntaxKind.JSDocTag:
                    case SyntaxKind.JSDocClassTag:
                    case SyntaxKind.JSDocOverrideTag:
                        return emitJSDocSimpleTag(node as JSDocTag);
                    case SyntaxKind.JSDocAugmentsTag:
                    case SyntaxKind.JSDocImplementsTag:
                        return emitJSDocHeritageTag(node as JSDocImplementsTag | JSDocAugmentsTag);
                    case SyntaxKind.JSDocAuthorTag:
                    case SyntaxKind.JSDocDeprecatedTag:
                        return;
                    // SyntaxKind.JSDocClassTag (see JSDocTag, above)
                    case SyntaxKind.JSDocPublicTag:
                    case SyntaxKind.JSDocPrivateTag:
                    case SyntaxKind.JSDocProtectedTag:
                    case SyntaxKind.JSDocReadonlyTag:
                        return;
                    case SyntaxKind.JSDocCallbackTag:
                        return emitJSDocCallbackTag(node as JSDocCallbackTag);
                    // SyntaxKind.JSDocEnumTag (see below)
                    case SyntaxKind.JSDocParameterTag:
                    case SyntaxKind.JSDocPropertyTag:
                        return emitJSDocPropertyLikeTag(node as JSDocPropertyLikeTag);
                    case SyntaxKind.JSDocEnumTag:
                    case SyntaxKind.JSDocReturnTag:
                    case SyntaxKind.JSDocThisTag:
                    case SyntaxKind.JSDocTypeTag:
                        return emitJSDocSimpleTypedTag(node as JSDocTypeTag);
                    case SyntaxKind.JSDocTemplateTag:
                        return emitJSDocTemplateTag(node as JSDocTemplateTag);
                    case SyntaxKind.JSDocTypedefTag:
                        return emitJSDocTypedefTag(node as JSDocTypedefTag);
                    case SyntaxKind.JSDocSeeTag:
                        return emitJSDocSeeTag(node as JSDocSeeTag);
                    // SyntaxKind.JSDocPropertyTag (see JSDocParameterTag, above)

                    // Transformation nodes
                    case SyntaxKind.NotEmittedStatement:
                    case SyntaxKind.EndOfDeclarationMarker:
                    case SyntaxKind.MergeDeclarationMarker:
                        return;
                }
                if (isExpression(node)) {
                    hint = EmitHint.Expression;
                    if (substituteNode !== noEmitSubstitution) {
                        const substitute = substituteNode(hint, node) || node;
                        if (substitute !== node) {
                            node = substitute;
                            if (currentParenthesizerRule) {
                                node = currentParenthesizerRule(node);
                            }
                        }
                    }
                }
            }
            if (hint === EmitHint.Expression) {
                switch (node.kind) {
                    // Literals
                    case SyntaxKind.NumericLiteral:
                    case SyntaxKind.BigIntLiteral:
                        return emitNumericOrBigIntLiteral(node as NumericLiteral | BigIntLiteral);

                    case SyntaxKind.StringLiteral:
                    case SyntaxKind.RegularExpressionLiteral:
                    case SyntaxKind.NoSubstitutionTemplateLiteral:
                        return emitLiteral(node as LiteralExpression, /*jsxAttributeEscape*/ false);

                    // Identifiers
                    case SyntaxKind.Identifier:
                        return emitIdentifier(node as Identifier);
                    case SyntaxKind.PrivateIdentifier:
                        return emitPrivateIdentifier(node as PrivateIdentifier);

                    // Expressions
                    case SyntaxKind.ArrayLiteralExpression:
                        return emitArrayLiteralExpression(node as ArrayLiteralExpression);
                    case SyntaxKind.ObjectLiteralExpression:
                        return emitObjectLiteralExpression(node as ObjectLiteralExpression);
                    case SyntaxKind.PropertyAccessExpression:
                        return emitPropertyAccessExpression(node as PropertyAccessExpression);
                    case SyntaxKind.ElementAccessExpression:
                        return emitElementAccessExpression(node as ElementAccessExpression);
                    case SyntaxKind.CallExpression:
                        return emitCallExpression(node as CallExpression);
                    case SyntaxKind.NewExpression:
                        return emitNewExpression(node as NewExpression);
                    case SyntaxKind.TaggedTemplateExpression:
                        return emitTaggedTemplateExpression(node as TaggedTemplateExpression);
                    case SyntaxKind.TypeAssertionExpression:
                        return emitTypeAssertionExpression(node as TypeAssertion);
                    case SyntaxKind.ParenthesizedExpression:
                        return emitParenthesizedExpression(node as ParenthesizedExpression);
                    case SyntaxKind.FunctionExpression:
                        return emitFunctionExpression(node as FunctionExpression);
                    case SyntaxKind.ArrowFunction:
                        return emitArrowFunction(node as ArrowFunction);
                    case SyntaxKind.DeleteExpression:
                        return emitDeleteExpression(node as DeleteExpression);
                    case SyntaxKind.TypeOfExpression:
                        return emitTypeOfExpression(node as TypeOfExpression);
                    case SyntaxKind.VoidExpression:
                        return emitVoidExpression(node as VoidExpression);
                    case SyntaxKind.AwaitExpression:
                        return emitAwaitExpression(node as AwaitExpression);
                    case SyntaxKind.PrefixUnaryExpression:
                        return emitPrefixUnaryExpression(node as PrefixUnaryExpression);
                    case SyntaxKind.PostfixUnaryExpression:
                        return emitPostfixUnaryExpression(node as PostfixUnaryExpression);
                    case SyntaxKind.BinaryExpression:
                        return emitBinaryExpression(node as BinaryExpression);
                    case SyntaxKind.ConditionalExpression:
                        return emitConditionalExpression(node as ConditionalExpression);
                    case SyntaxKind.TemplateExpression:
                        return emitTemplateExpression(node as TemplateExpression);
                    case SyntaxKind.YieldExpression:
                        return emitYieldExpression(node as YieldExpression);
                    case SyntaxKind.SpreadElement:
                        return emitSpreadElement(node as SpreadElement);
                    case SyntaxKind.ClassExpression:
                        return emitClassExpression(node as ClassExpression);
                    case SyntaxKind.OmittedExpression:
                        return;
                    case SyntaxKind.AsExpression:
                        return emitAsExpression(node as AsExpression);
                    case SyntaxKind.NonNullExpression:
                        return emitNonNullExpression(node as NonNullExpression);
                    case SyntaxKind.ExpressionWithTypeArguments:
                        return emitExpressionWithTypeArguments(node as ExpressionWithTypeArguments);
                    case SyntaxKind.MetaProperty:
                        return emitMetaProperty(node as MetaProperty);
                    case SyntaxKind.SyntheticExpression:
                        return Debug.fail("SyntheticExpression should never be printed.");

                    // JSX
                    case SyntaxKind.JsxElement:
                        return emitJsxElement(node as JsxElement);
                    case SyntaxKind.JsxSelfClosingElement:
                        return emitJsxSelfClosingElement(node as JsxSelfClosingElement);
                    case SyntaxKind.JsxFragment:
                        return emitJsxFragment(node as JsxFragment);

                    // Synthesized list
                    case SyntaxKind.SyntaxList:
                        return Debug.fail("SyntaxList should not be printed");

                    // Transformation nodes
                    case SyntaxKind.NotEmittedStatement:
                        return;
                    case SyntaxKind.PartiallyEmittedExpression:
                        return emitPartiallyEmittedExpression(node as PartiallyEmittedExpression);
                    case SyntaxKind.CommaListExpression:
                        return emitCommaList(node as CommaListExpression);
                    case SyntaxKind.MergeDeclarationMarker:
                    case SyntaxKind.EndOfDeclarationMarker:
                        return;
                    case SyntaxKind.SyntheticReferenceExpression:
                        return Debug.fail("SyntheticReferenceExpression should not be printed");
                }
            }
            if (isKeyword(node.kind)) return writeTokenNode(node, writeKeyword);
            if (isTokenKind(node.kind)) return writeTokenNode(node, writePunctuation);
            Debug.fail(`Unhandled SyntaxKind: ${Debug.formatSyntaxKind(node.kind)}.`);
        }

        function emitMappedTypeParameter(node: TypeParameterDeclaration): void {
            emit(node.name);
            writeSpace();
            writeKeyword("in");
            writeSpace();
            emit(node.constraint);
        }

        function pipelineEmitWithSubstitution(hint: EmitHint, node: Node) {
            const pipelinePhase = getNextPipelinePhase(PipelinePhase.Substitution, hint, node);
            Debug.assertIsDefined(lastSubstitution);
            node = lastSubstitution;
            lastSubstitution = undefined;
            pipelinePhase(hint, node);
        }

        function getHelpersFromBundledSourceFiles(bundle: Bundle): string[] | undefined {
            let result: string[] | undefined;
            if (moduleKind === ModuleKind.None || printerOptions.noEmitHelpers) {
                return undefined;
            }
            const bundledHelpers = new Map<string, boolean>();
            for (const sourceFile of bundle.sourceFiles) {
                const shouldSkip = getExternalHelpersModuleName(sourceFile) !== undefined;
                const helpers = getSortedEmitHelpers(sourceFile);
                if (!helpers) continue;
                for (const helper of helpers) {
                    if (!helper.scoped && !shouldSkip && !bundledHelpers.get(helper.name)) {
                        bundledHelpers.set(helper.name, true);
                        (result || (result = [])).push(helper.name);
                    }
                }
            }

            return result;
        }

        function emitHelpers(node: Node) {
            let helpersEmitted = false;
            const bundle = node.kind === SyntaxKind.Bundle ? node as Bundle : undefined;
            if (bundle && moduleKind === ModuleKind.None) {
                return;
            }
            const numPrepends = bundle ? bundle.prepends.length : 0;
            const numNodes = bundle ? bundle.sourceFiles.length + numPrepends : 1;
            for (let i = 0; i < numNodes; i++) {
                const currentNode = bundle ? i < numPrepends ? bundle.prepends[i] : bundle.sourceFiles[i - numPrepends] : node;
                const sourceFile = isSourceFile(currentNode) ? currentNode : isUnparsedSource(currentNode) ? undefined : currentSourceFile!;
                const shouldSkip = printerOptions.noEmitHelpers || (!!sourceFile && hasRecordedExternalHelpers(sourceFile));
                const shouldBundle = (isSourceFile(currentNode) || isUnparsedSource(currentNode)) && !isOwnFileEmit;
                const helpers = isUnparsedSource(currentNode) ? currentNode.helpers : getSortedEmitHelpers(currentNode);
                if (helpers) {
                    for (const helper of helpers) {
                        if (!helper.scoped) {
                            // Skip the helper if it can be skipped and the noEmitHelpers compiler
                            // option is set, or if it can be imported and the importHelpers compiler
                            // option is set.
                            if (shouldSkip) continue;

                            // Skip the helper if it can be bundled but hasn't already been emitted and we
                            // are emitting a bundled module.
                            if (shouldBundle) {
                                if (bundledHelpers.get(helper.name)) {
                                    continue;
                                }

                                bundledHelpers.set(helper.name, true);
                            }
                        }
                        else if (bundle) {
                            // Skip the helper if it is scoped and we are emitting bundled helpers
                            continue;
                        }
                        const pos = getTextPosWithWriteLine();
                        if (typeof helper.text === "string") {
                            writeLines(helper.text);
                        }
                        else {
                            writeLines(helper.text(makeFileLevelOptimisticUniqueName));
                        }
                        if (bundleFileInfo) bundleFileInfo.sections.push({ pos, end: writer.getTextPos(), kind: BundleFileSectionKind.EmitHelpers, data: helper.name });
                        helpersEmitted = true;
                    }
                }
            }

            return helpersEmitted;
        }

        function getSortedEmitHelpers(node: Node) {
            const helpers = getEmitHelpers(node);
            return helpers && stableSort(helpers, compareEmitHelpers);
        }

        //
        // Literals/Pseudo-literals
        //
/*
        function emitQJSNewInt32(qjsVar: QJSVar, num: string) {
            writeQJSKeyword(qjsVar.name);
            writeQJSSpace();
            writeQJSOperator("=");
            writeQJSSpace();

            if (qjsVar.type === QJSCType.JSValue) {
                writeQJSBase(generateQJSNewInt32(num));
            }
            else {
                writeQJSBase(num.toString());
            }

            writeQJSTrailingSemicolon();
            writeQJSLine();
        }
*/
        // SyntaxKind.NumericLiteral
        // SyntaxKind.BigIntLiteral
        function emitQJSIntLiteral(num: Number) {
            if (!printerOptions.emitQJSCode) {
                return;
            }
            if (qjsEmitterState !== QJSValueStackState.RValue) {
                return;
            }

            Debug.assert(qjsEmitterState === QJSValueStackState.RValue);

            const qjsVar = prepareQJSTempVar(QJSCType.Int, QJSJSType.NumLiteral);
            qjsVar.value = num.toString();
            qjsVar.needfree = false;

            writeQJSKeyword(qjsTypeInfo[QJSCType.Int].type);
            writeQJSSpace();
            writeQJSKeyword(qjsVar.name);
            writeQJSSpace();
            writeQJSPunctuation("=");
            writeQJSSpace();
            writeQJSBase(num.toString());
            writeQJSTrailingSemicolon();
            writeQJSLine();
        }

        function emitQJSFloat64Literal(num: Number) {
            if (!printerOptions.emitQJSCode) {
                return;
            }
            if (qjsEmitterState !== QJSValueStackState.RValue) {
                return;
            }

            const qjsVar = prepareQJSTempVar(QJSCType.Double, QJSJSType.NumLiteral);
            qjsVar.value = num.toString();
            qjsVar.needfree = false;

            writeQJSKeyword(qjsTypeInfo[QJSCType.Double].type);
            writeQJSSpace();
            writeQJSKeyword(qjsVar.name);
            writeQJSSpace();
            writeQJSPunctuation("=");
            writeQJSSpace();
            writeQJSBase(num.toString());
            writeQJSTrailingSemicolon();
            writeQJSLine();
        }

        function emitNumericOrBigIntLiteral(node: NumericLiteral | BigIntLiteral) {
            emitLiteral(node, /*jsxAttributeEscape*/ false);
        }

        function emitQJSStringLiteral(text: string) {
            if (!printerOptions.emitQJSCode) {
                return;
            }
            if (qjsEmitterState !== QJSValueStackState.RValue) {
                return;
            }

            Debug.assert(qjsEmitterState === QJSValueStackState.RValue);

            const qjsVar = prepareQJSTempVar(QJSCType.JSValue, QJSJSType.StringLiteral);
            qjsVar.value = text.substring(1, text.length - 1);

            writeQJSKeyword(qjsTypeInfo[QJSCType.JSValue].type);
            writeQJSSpace();
            writeQJSKeyword(qjsVar.name);
            writeQJSSpace();
            writeQJSPunctuation("=");
            writeQJSSpace();
            writeQJSBase(generateQJSNewString(text));
            writeQJSTrailingSemicolon();
            writeQJSLine();
        }

        // SyntaxKind.StringLiteral
        // SyntaxKind.RegularExpressionLiteral
        // SyntaxKind.NoSubstitutionTemplateLiteral
        // SyntaxKind.TemplateHead
        // SyntaxKind.TemplateMiddle
        // SyntaxKind.TemplateTail
        function emitLiteral(node: LiteralLikeNode, jsxAttributeEscape: boolean) {
            const text = getLiteralTextOfNode(node, printerOptions.neverAsciiEscape, jsxAttributeEscape);
            if ((printerOptions.sourceMap || printerOptions.inlineSourceMap)
                && (node.kind === SyntaxKind.StringLiteral || isTemplateLiteralKind(node.kind))) {
                writeLiteral(text);
            }
            else {
                // Quick info expects all literals to be called with writeStringLiteral, as there's no specific type for numberLiterals
                writeStringLiteral(text);

                if (!!printerOptions.emitQJSCode) {
                    if (node.kind === SyntaxKind.NumericLiteral) {
                        const num = +text;
                        if (Number.isInteger(num) && num <= 0x7fffffff) {
                            emitQJSIntLiteral(num);
                        }
                        else {
                            emitQJSFloat64Literal(num);
                        }
                    }
                    else if (node.kind === SyntaxKind.StringLiteral) {
                        emitQJSStringLiteral(text);
                    }
                }
            }
        }

        // SyntaxKind.UnparsedSource
        // SyntaxKind.UnparsedPrepend
        function emitUnparsedSourceOrPrepend(unparsed: UnparsedSource | UnparsedPrepend) {
            for (const text of unparsed.texts) {
                writeLine();
                emit(text);
            }
        }

        // SyntaxKind.UnparsedPrologue
        // SyntaxKind.UnparsedText
        // SyntaxKind.UnparsedInternal
        // SyntaxKind.UnparsedSyntheticReference
        function writeUnparsedNode(unparsed: UnparsedNode) {
            writer.rawWrite(unparsed.parent.text.substring(unparsed.pos, unparsed.end));
        }

        // SyntaxKind.UnparsedText
        // SyntaxKind.UnparsedInternal
        function emitUnparsedTextLike(unparsed: UnparsedTextLike) {
            const pos = getTextPosWithWriteLine();
            writeUnparsedNode(unparsed);
            if (bundleFileInfo) {
                updateOrPushBundleFileTextLike(
                    pos,
                    writer.getTextPos(),
                    unparsed.kind === SyntaxKind.UnparsedText ?
                        BundleFileSectionKind.Text :
                        BundleFileSectionKind.Internal
                );
            }
        }

        // SyntaxKind.UnparsedSyntheticReference
        function emitUnparsedSyntheticReference(unparsed: UnparsedSyntheticReference) {
            const pos = getTextPosWithWriteLine();
            writeUnparsedNode(unparsed);
            if (bundleFileInfo) {
                const section = clone(unparsed.section);
                section.pos = pos;
                section.end = writer.getTextPos();
                bundleFileInfo.sections.push(section);
            }
        }

        //
        // Snippet Elements
        //

        function emitSnippetNode(hint: EmitHint, node: Node, snippet: SnippetElement) {
            switch (snippet.kind) {
                case SnippetKind.Placeholder:
                    emitPlaceholder(hint, node, snippet);
                    break;
                case SnippetKind.TabStop:
                    emitTabStop(hint, node, snippet);
                    break;
            }
        }

        function emitPlaceholder(hint: EmitHint, node: Node, snippet: Placeholder) {
            nonEscapingWrite(`\$\{${snippet.order}:`); // `${2:`
            pipelineEmitWithHintWorker(hint, node, /*allowSnippets*/ false); // `...`
            nonEscapingWrite(`\}`); // `}`
            // `${2:...}`
        }

        function emitTabStop(hint: EmitHint, node: Node, snippet: TabStop) {
            // A tab stop should only be attached to an empty node, i.e. a node that doesn't emit any text.
            Debug.assert(node.kind === SyntaxKind.EmptyStatement,
                `A tab stop cannot be attached to a node of kind ${Debug.formatSyntaxKind(node.kind)}.`);
            Debug.assert(hint !== EmitHint.EmbeddedStatement,
                `A tab stop cannot be attached to an embedded statement.`);
            nonEscapingWrite(`\$${snippet.order}`);
        }

        //
        // Identifiers
        //
/*
        function getQJSVarByType(jsVar: QJSJSVar, ctype: QJSCType): QJSVar | undefined {
            for (const qjsVar of jsVar.define) {
                if (qjsVar.type === ctype) {
                    return qjsVar;
                }
            }

            return undefined;
        }
*/
        function qjsGetCurFrame(): QJSFrame {
            return qjsCallFrames[qjsCallFrames.length - 1];
        }

        function qjsUpdateClosestPhiNode(jsVar: QJSJSVar) {
            let curFrame = qjsGetCurFrame();
            switch(qjsCurBlockType) {
                case QJSBlockType.IfThen:
                    {
                        curFrame = curFrame.preframe!;
                        Debug.assert(curFrame.phinodes.length === 1);
                        const phinode: QJSIfPhiNode = curFrame.phinodes[0] as QJSIfPhiNode;
                        //phinode.originVars.set(innermostVar!.name, innermostVar!.outer!);
                        phinode.thenVars.set(jsVar.name, jsVar);
                    }
                    break;
                case QJSBlockType.IfElse:
                    {
                        curFrame = curFrame.preframe!;
                        Debug.assert(curFrame.phinodes.length === 1);
                        const phinode: QJSIfPhiNode = curFrame.phinodes[0] as QJSIfPhiNode;
                        phinode.elseVars.set(jsVar.name, jsVar);
                    }
                    break;
                case QJSBlockType.Loop:
                    {
                        curFrame = curFrame.preframe!;
                        Debug.assert(curFrame.phinodes.length === 1);
                        const phinode: QJSLoopPhiNode = curFrame.phinodes[0] as QJSLoopPhiNode;
                        phinode.loopVars.set(jsVar.name, jsVar);
                    }
                    break;
                default:
                    break;
            };
        }

        function qjsWriteBackObjectsWithSameProp(jsVar: QJSJSVar) {
            if (jsVar.kind === QJSJSVarKind.Prop) {
                // force to sync all object with same prop name due to aliasing.
                const [jsobj, jsname] = jsVar.name.split("|");
                const atomName = qjsAtomMap.get(jsname)!;

                let curFrame: QJSFrame | undefined = qjsGetCurFrame();
                const curFunc = qjsGetCurFunction(curFrame);
                const hasWrite: Set<string> = new Set();

                while (curFrame && curFunc === qjsGetCurFunction(curFrame)) {
                    curFrame.jsvarmap.forEach((value, key) => {
                        if (value.kind === QJSJSVarKind.Prop &&
                            value.needsync) {
                            const [obj, name] = key.split("|");
                            if (jsname === name &&
                                obj !== jsobj &&
                                !hasWrite.has(key)) {
                                emitQJSSetProperty(obj, atomName, value.cvar);
                                value.needsync = false;

                                hasWrite.add(key);
                            }
                        }
                    });

                    curFrame = curFrame.preframe;
                }
            }
        }

        function qjsUpdateFrame(jsVar: QJSJSVar) {
            const qjsVar = jsVar.cvar;
            const outerJsVar = jsVar;
            const outerFrame = outerJsVar.frame;
            let curFrame = qjsGetCurFrame();

            if (curFrame === outerFrame) {

                qjsWriteBackObjectsWithSameProp(jsVar);
                return;
            }

            let innerVar: QJSJSVar | undefined;
            let innermostVar: QJSJSVar | undefined;
            while (curFrame !== outerFrame) {
                Debug.assert(!curFrame.jsvarmap.get(outerJsVar.name));
                const newJsVar = qjsNewJSVar(outerJsVar.name, outerJsVar.type, outerJsVar.kind, qjsVar, curFrame);
                newJsVar.inited = outerJsVar.inited; // for global var

                curFrame = curFrame.preframe!;

                if (innerVar) {
                    innerVar.outer = newJsVar;
                }
                innerVar = newJsVar;

                if (!innermostVar) {
                    innermostVar = newJsVar;
                }
            }

            qjsVar.jsvar = innermostVar;

            if (innerVar) {
                innerVar.outer = outerJsVar;
            }

            qjsWriteBackObjectsWithSameProp(innermostVar!);

            qjsUpdateClosestPhiNode(innermostVar!);

        }

        function resolveQJSIdentifierInternal(name: string): QJSJSVar | undefined {
            let curFrame: QJSFrame | undefined = qjsGetCurFrame();

            while (curFrame) {
                const jsVarMap = curFrame.jsvarmap;
                const jsvar = jsVarMap.get(name);
                if (jsvar) {
                    return jsvar;
                }

                curFrame = curFrame.preframe;
            }

            return undefined;
        }

        function qjsGetVarRefIndex(varname: string): number {
            const frame = qjsGetCurFrame();
            if (frame.function.kind === SyntaxKind.FunctionDeclaration) {
                const originFunc = getParseTreeNode(frame.function);
                for (let i = 0; i < (originFunc as FunctionDeclaration).closureVars.length; i ++) {
                    if ((originFunc as FunctionDeclaration).closureVars[i].name === varname) {
                        return i;
                    }
                }
            }

            Debug.fail("Should be unreachable.");
            return -1;
        }

        function emitQJSDeclareClosureVar(qjsVar: QJSVar, varrefIndex: number) {
            writeQJSKeyword(qjsTypeInfo[QJSCType.JSValue].type);
            writeQJSSpace();
            writeQJSKeyword(qjsVar.name);
            writeQJSSpace();
            writeQJSPunctuation("=");
            writeQJSSpace();
            writeQJSBase("var_refs[" + varrefIndex + "]->pvalue");
            writeQJSTrailingSemicolon();
            writeQJSLine();
        }

        function resolveQJSIdentifier(node: Identifier, ctype: QJSCType, jstype: QJSJSType = QJSJSType.Undefined) {
            const jsName = getTextOfNode(node, /*includeTrivia*/ false);
            // first find local var
            const qjsJSVarMap = qjsGetCurFrame().jsvarmap;
            let jsVar = qjsJSVarMap.get(jsName);

            if (!jsVar) {
                // find jsvar in outer frames.
                jsVar = resolveQJSIdentifierInternal(jsName);

                if(!jsVar) {
                    // not local var or global var in this file, it's a builtin global var
                    if (!hasGlobalName || (hasGlobalName && !hasGlobalName(jsName))) {
                        Debug.fail("qjsEmitter: cannot resolve " + jsName);
                    }

                    const varName = generateQJSVarName(ctype, jsName);
                    const qjsVar = qjsNewVar(undefined, QJSCType.JSValue, varName, false);
                    qjsVar.jstype = jstype;
                    if (jstype < QJSJSType.RefType) {
                        qjsVar.needfree = false;
                    }
                    pushQJSValueStack(qjsVar);

                    jsVar = qjsNewJSVar(jsName, jstype, QJSJSVarKind.GlobalVar, qjsVar, qjsGetCurFrame());

                    emitQJSDeclareQJSVar(qjsVar);
                    return;
                }

                if (jsVar.kind === QJSJSVarKind.LocalVar) {
                    if (jsVar.frame.function !== qjsGetCurFrame().function) {
                        let jstype: QJSJSType = jsVar.type;
                        if (jsVar.type === QJSJSType.NumLiteral) {
                            jstype = QJSJSType.Float64;
                        }
                        const varName = generateQJSVarName(QJSCType.JSValue, jsName, true);
                        const qjsVar = qjsNewVar(undefined, QJSCType.JSValue, varName, false);
                        qjsVar.jstype = jstype;
                        if (jstype < QJSJSType.RefType) {
                            qjsVar.needfree = false;
                        }
                        pushQJSValueStack(qjsVar);
                        jsVar = qjsNewJSVar(jsVar.name, jstype, QJSJSVarKind.LocalVar, qjsVar, qjsGetCurFrame());
                        const varrefIndex = qjsGetVarRefIndex(jsName);

                        emitQJSDeclareClosureVar(qjsVar, varrefIndex);
                        return;
                    }
                }
                else if (jsVar.kind === QJSJSVarKind.GlobalVar &&
                    qjsGetCurFunction(jsVar.frame) !==
                    qjsGetCurFunction(qjsGetCurFrame())) {

                    let jstype: QJSJSType = jsVar.type;
                    if (jsVar.type === QJSJSType.NumLiteral) {
                        jstype = QJSJSType.Float64;
                    }

                    const varName = generateQJSVarName(QJSCType.JSValue, jsName);
                    const qjsVar = qjsNewVar(undefined, QJSCType.JSValue, varName);

                    qjsVar.jstype = jstype;
                    if (jstype < QJSJSType.RefType) {
                        qjsVar.needfree = false;
                    }

                    pushQJSValueStack(qjsVar);
                    const flags = jsVar.flags;
                    jsVar = qjsNewJSVar(jsVar.name, jstype, QJSJSVarKind.GlobalVar, qjsVar, qjsGetCurFrame());
                    jsVar.flags = flags;

                    emitQJSDeclareQJSVar(qjsVar);
                    return;
                }
            }

            const qjsVar = jsVar.cvar;

            Debug.assert(!!qjsVar, "qjs emitter: can't set lvalue var.");
            qjsValueStack.push(qjsVar);
        }

        function emitQJSIdentifier(node: Identifier) {
            if (!printerOptions.emitQJSCode) {
                return;
            }

            if (node.parent) {
                if (node.parent.kind === SyntaxKind.Parameter) {
                    return;
                }

                if (node.parent.kind === SyntaxKind.ImportSpecifier &&
                    (node.parent as ImportSpecifier).propertyName === node) {
                    return;
                }

                if (node.parent.kind === SyntaxKind.PropertyAccessExpression &&
                    (node.parent as PropertyAccessExpression).name === node) {
                    return;
                }
            }

            const symbol = checker!.getSymbolAtLocation(node);
            const type = checker!.getTypeAtLocation(node);

            if (!symbol) {
                Debug.fail("qjs emitter: cannot find the symbol.");
            }

            if (symbol.flags & SymbolFlags.Variable) {
                let jstype = QJSJSType.Undefined;
                let ctype = QJSCType.JSValue;
                if (type.flags & TypeFlags.Number) {
                    jstype = QJSJSType.Float64;
                    ctype = QJSCType.Number;
                }
                else if (type.flags & TypeFlags.Object) {
                    jstype = QJSJSType.Object;
                    ctype = QJSCType.JSValue;
                }
                else if (type.flags & TypeFlags.String) {
                    jstype = QJSJSType.String;
                    ctype = QJSCType.JSValue;
                }

                resolveQJSIdentifier(node, ctype, jstype);
            }
            else if (symbol.flags & SymbolFlags.Function) {
                resolveQJSIdentifier(node, QJSCType.JSValue, QJSJSType.Function);
            }
            else if (symbol.flags & SymbolFlags.Alias) {
                let jstype = QJSJSType.Undefined;
                let ctype = QJSCType.JSValue;
                if (type.flags & TypeFlags.Number) {
                    jstype = QJSJSType.Float64;
                    ctype = QJSCType.Number;
                }
                else if (type.flags & TypeFlags.Object) {
                    jstype = QJSJSType.Object;
                    ctype = QJSCType.JSValue;
                }
                resolveQJSIdentifier(node, ctype, jstype);
            }
        }

        function emitIdentifier(node: Identifier) {
            const writeText = node.symbol ? writeSymbol : write;
            writeText(getTextOfNode(node, /*includeTrivia*/ false), node.symbol);

            emitQJSIdentifier(node);

            emitList(node, node.typeArguments, ListFormat.TypeParameters); // Call emitList directly since it could be an array of TypeParameterDeclarations _or_ type arguments
        }

        //
        // Names
        //

        function emitPrivateIdentifier(node: PrivateIdentifier) {
            const writeText = node.symbol ? writeSymbol : write;
            writeText(getTextOfNode(node, /*includeTrivia*/ false), node.symbol);
        }


        function emitQualifiedName(node: QualifiedName) {
            emitEntityName(node.left);
            writePunctuation(".");
            emit(node.right);
        }

        function emitEntityName(node: EntityName) {
            if (node.kind === SyntaxKind.Identifier) {
                emitExpression(node);
            }
            else {
                emit(node);
            }
        }

        function emitComputedPropertyName(node: ComputedPropertyName) {
            writePunctuation("[");
            emitExpression(node.expression, parenthesizer.parenthesizeExpressionOfComputedPropertyName);
            writePunctuation("]");
        }

        //
        // Signature elements
        //

        function emitTypeParameter(node: TypeParameterDeclaration) {
            emitModifiers(node, node.modifiers);
            emit(node.name);
            if (node.constraint) {
                writeSpace();
                writeKeyword("extends");
                writeSpace();
                emit(node.constraint);
            }
            if (node.default) {
                writeSpace();
                writeOperator("=");
                writeSpace();
                emit(node.default);
            }
        }

        function emitParameter(node: ParameterDeclaration) {
            emitDecorators(node, node.decorators);
            emitModifiers(node, node.modifiers);
            emit(node.dotDotDotToken);
            emitNodeWithWriter(node.name, writeParameter);
            emit(node.questionToken);
            if (node.parent && node.parent.kind === SyntaxKind.JSDocFunctionType && !node.name) {
                emit(node.type);
            }
            else {
                emitTypeAnnotation(node.type);
            }
            // The comment position has to fallback to any present node within the parameterdeclaration because as it turns out, the parser can make parameter declarations with _just_ an initializer.
            emitInitializer(node.initializer, node.type ? node.type.end : node.questionToken ? node.questionToken.end : node.name ? node.name.end : node.modifiers ? node.modifiers.end : node.decorators ? node.decorators.end : node.pos, node, parenthesizer.parenthesizeExpressionForDisallowedComma);
        }

        function emitDecorator(decorator: Decorator) {
            writePunctuation("@");
            emitExpression(decorator.expression, parenthesizer.parenthesizeLeftSideOfAccess);
        }

        //
        // Type members
        //

        function emitPropertySignature(node: PropertySignature) {
            emitDecorators(node, node.decorators);
            emitModifiers(node, node.modifiers);
            emitNodeWithWriter(node.name, writeProperty);
            emit(node.questionToken);
            emitTypeAnnotation(node.type);
            writeTrailingSemicolon();
        }

        function emitPropertyDeclaration(node: PropertyDeclaration) {
            emitDecorators(node, node.decorators);
            emitModifiers(node, node.modifiers);
            emit(node.name);
            emit(node.questionToken);
            emit(node.exclamationToken);
            emitTypeAnnotation(node.type);
            emitInitializer(node.initializer, node.type ? node.type.end : node.questionToken ? node.questionToken.end : node.name.end, node);
            writeTrailingSemicolon();
        }

        function emitMethodSignature(node: MethodSignature) {
            pushNameGenerationScope(node);
            emitDecorators(node, node.decorators);
            emitModifiers(node, node.modifiers);
            emit(node.name);
            emit(node.questionToken);
            emitTypeParameters(node, node.typeParameters);
            emitParameters(node, node.parameters);
            emitTypeAnnotation(node.type);
            writeTrailingSemicolon();
            popNameGenerationScope(node);
        }

        function emitMethodDeclaration(node: MethodDeclaration) {
            emitDecorators(node, node.decorators);
            emitModifiers(node, node.modifiers);
            emit(node.asteriskToken);
            emit(node.name);
            emit(node.questionToken);
            emitSignatureAndBody(node, emitSignatureHead);
        }

        function emitClassStaticBlockDeclaration(node: ClassStaticBlockDeclaration) {
            emitDecorators(node, node.decorators);
            emitModifiers(node, node.modifiers);
            writeKeyword("static");
            emitBlockFunctionBody(node.body);
        }

        function emitConstructor(node: ConstructorDeclaration) {
            emitModifiers(node, node.modifiers);
            writeKeyword("constructor");
            emitSignatureAndBody(node, emitSignatureHead);
        }

        function emitAccessorDeclaration(node: AccessorDeclaration) {
            emitDecorators(node, node.decorators);
            emitModifiers(node, node.modifiers);
            writeKeyword(node.kind === SyntaxKind.GetAccessor ? "get" : "set");
            writeSpace();
            emit(node.name);
            emitSignatureAndBody(node, emitSignatureHead);
        }

        function emitCallSignature(node: CallSignatureDeclaration) {
            pushNameGenerationScope(node);
            emitDecorators(node, node.decorators);
            emitModifiers(node, node.modifiers);
            emitTypeParameters(node, node.typeParameters);
            emitParameters(node, node.parameters);
            emitTypeAnnotation(node.type);
            writeTrailingSemicolon();
            popNameGenerationScope(node);
        }

        function emitConstructSignature(node: ConstructSignatureDeclaration) {
            pushNameGenerationScope(node);
            emitDecorators(node, node.decorators);
            emitModifiers(node, node.modifiers);
            writeKeyword("new");
            writeSpace();
            emitTypeParameters(node, node.typeParameters);
            emitParameters(node, node.parameters);
            emitTypeAnnotation(node.type);
            writeTrailingSemicolon();
            popNameGenerationScope(node);
        }

        function emitIndexSignature(node: IndexSignatureDeclaration) {
            emitDecorators(node, node.decorators);
            emitModifiers(node, node.modifiers);
            emitParametersForIndexSignature(node, node.parameters);
            emitTypeAnnotation(node.type);
            writeTrailingSemicolon();
        }

        function emitTemplateTypeSpan(node: TemplateLiteralTypeSpan) {
            emit(node.type);
            emit(node.literal);
        }

        function emitSemicolonClassElement() {
            writeTrailingSemicolon();
        }

        //
        // Types
        //

        function emitTypePredicate(node: TypePredicateNode) {
            if (node.assertsModifier) {
                emit(node.assertsModifier);
                writeSpace();
            }
            emit(node.parameterName);
            if (node.type) {
                writeSpace();
                writeKeyword("is");
                writeSpace();
                emit(node.type);
            }
        }

        function emitTypeReference(node: TypeReferenceNode) {
            emit(node.typeName);
            emitTypeArguments(node, node.typeArguments);
        }

        function emitFunctionType(node: FunctionTypeNode) {
            pushNameGenerationScope(node);
            emitTypeParameters(node, node.typeParameters);
            emitParametersForArrow(node, node.parameters);
            writeSpace();
            writePunctuation("=>");
            writeSpace();
            emit(node.type);
            popNameGenerationScope(node);
        }

        function emitJSDocFunctionType(node: JSDocFunctionType) {
            writeKeyword("function");
            emitParameters(node, node.parameters);
            writePunctuation(":");
            emit(node.type);
        }


        function emitJSDocNullableType(node: JSDocNullableType) {
            writePunctuation("?");
            emit(node.type);
        }

        function emitJSDocNonNullableType(node: JSDocNonNullableType) {
            writePunctuation("!");
            emit(node.type);
        }

        function emitJSDocOptionalType(node: JSDocOptionalType) {
            emit(node.type);
            writePunctuation("=");
        }

        function emitConstructorType(node: ConstructorTypeNode) {
            pushNameGenerationScope(node);
            emitModifiers(node, node.modifiers);
            writeKeyword("new");
            writeSpace();
            emitTypeParameters(node, node.typeParameters);
            emitParameters(node, node.parameters);
            writeSpace();
            writePunctuation("=>");
            writeSpace();
            emit(node.type);
            popNameGenerationScope(node);
        }

        function emitTypeQuery(node: TypeQueryNode) {
            writeKeyword("typeof");
            writeSpace();
            emit(node.exprName);
            emitTypeArguments(node, node.typeArguments);
        }

        function emitTypeLiteral(node: TypeLiteralNode) {
            writePunctuation("{");
            const flags = getEmitFlags(node) & EmitFlags.SingleLine ? ListFormat.SingleLineTypeLiteralMembers : ListFormat.MultiLineTypeLiteralMembers;
            emitList(node, node.members, flags | ListFormat.NoSpaceIfEmpty);
            writePunctuation("}");
        }

        function emitArrayType(node: ArrayTypeNode) {
            emit(node.elementType, parenthesizer.parenthesizeNonArrayTypeOfPostfixType);
            writePunctuation("[");
            writePunctuation("]");
        }

        function emitRestOrJSDocVariadicType(node: RestTypeNode | JSDocVariadicType) {
            writePunctuation("...");
            emit(node.type);
        }

        function emitTupleType(node: TupleTypeNode) {
            emitTokenWithComment(SyntaxKind.OpenBracketToken, node.pos, writePunctuation, node);
            const flags = getEmitFlags(node) & EmitFlags.SingleLine ? ListFormat.SingleLineTupleTypeElements : ListFormat.MultiLineTupleTypeElements;
            emitList(node, node.elements, flags | ListFormat.NoSpaceIfEmpty, parenthesizer.parenthesizeElementTypeOfTupleType);
            emitTokenWithComment(SyntaxKind.CloseBracketToken, node.elements.end, writePunctuation, node);
        }

        function emitNamedTupleMember(node: NamedTupleMember) {
            emit(node.dotDotDotToken);
            emit(node.name);
            emit(node.questionToken);
            emitTokenWithComment(SyntaxKind.ColonToken, node.name.end, writePunctuation, node);
            writeSpace();
            emit(node.type);
        }

        function emitOptionalType(node: OptionalTypeNode) {
            emit(node.type, parenthesizer.parenthesizeTypeOfOptionalType);
            writePunctuation("?");
        }

        function emitUnionType(node: UnionTypeNode) {
            emitList(node, node.types, ListFormat.UnionTypeConstituents, parenthesizer.parenthesizeConstituentTypeOfUnionType);
        }

        function emitIntersectionType(node: IntersectionTypeNode) {
            emitList(node, node.types, ListFormat.IntersectionTypeConstituents, parenthesizer.parenthesizeConstituentTypeOfIntersectionType);
        }

        function emitConditionalType(node: ConditionalTypeNode) {
            emit(node.checkType, parenthesizer.parenthesizeCheckTypeOfConditionalType);
            writeSpace();
            writeKeyword("extends");
            writeSpace();
            emit(node.extendsType, parenthesizer.parenthesizeExtendsTypeOfConditionalType);
            writeSpace();
            writePunctuation("?");
            writeSpace();
            emit(node.trueType);
            writeSpace();
            writePunctuation(":");
            writeSpace();
            emit(node.falseType);
        }

        function emitInferType(node: InferTypeNode) {
            writeKeyword("infer");
            writeSpace();
            emit(node.typeParameter);
        }

        function emitParenthesizedType(node: ParenthesizedTypeNode) {
            writePunctuation("(");
            emit(node.type);
            writePunctuation(")");
        }

        function emitThisType() {
            writeKeyword("this");
        }

        function emitTypeOperator(node: TypeOperatorNode) {
            writeTokenText(node.operator, writeKeyword);
            writeSpace();

            const parenthesizerRule = node.operator === SyntaxKind.ReadonlyKeyword ?
                parenthesizer.parenthesizeOperandOfReadonlyTypeOperator :
                parenthesizer.parenthesizeOperandOfTypeOperator;
            emit(node.type, parenthesizerRule);
        }

        function emitIndexedAccessType(node: IndexedAccessTypeNode) {
            emit(node.objectType, parenthesizer.parenthesizeNonArrayTypeOfPostfixType);
            writePunctuation("[");
            emit(node.indexType);
            writePunctuation("]");
        }

        function emitMappedType(node: MappedTypeNode) {
            const emitFlags = getEmitFlags(node);
            writePunctuation("{");
            if (emitFlags & EmitFlags.SingleLine) {
                writeSpace();
            }
            else {
                writeLine();
                increaseIndent();
            }
            if (node.readonlyToken) {
                emit(node.readonlyToken);
                if (node.readonlyToken.kind !== SyntaxKind.ReadonlyKeyword) {
                    writeKeyword("readonly");
                }
                writeSpace();
            }
            writePunctuation("[");

            pipelineEmit(EmitHint.MappedTypeParameter, node.typeParameter);
            if (node.nameType) {
                writeSpace();
                writeKeyword("as");
                writeSpace();
                emit(node.nameType);
            }

            writePunctuation("]");
            if (node.questionToken) {
                emit(node.questionToken);
                if (node.questionToken.kind !== SyntaxKind.QuestionToken) {
                    writePunctuation("?");
                }
            }
            writePunctuation(":");
            writeSpace();
            emit(node.type);
            writeTrailingSemicolon();
            if (emitFlags & EmitFlags.SingleLine) {
                writeSpace();
            }
            else {
                writeLine();
                decreaseIndent();
            }
            emitList(node, node.members, ListFormat.PreserveLines);
            writePunctuation("}");
        }

        function emitLiteralType(node: LiteralTypeNode) {
            emitExpression(node.literal);
        }

        function emitTemplateType(node: TemplateLiteralTypeNode) {
            emit(node.head);
            emitList(node, node.templateSpans, ListFormat.TemplateExpressionSpans);
        }

        function emitImportTypeNode(node: ImportTypeNode) {
            if (node.isTypeOf) {
                writeKeyword("typeof");
                writeSpace();
            }
            writeKeyword("import");
            writePunctuation("(");
            emit(node.argument);
            if (node.assertions) {
                writePunctuation(",");
                writeSpace();
                writePunctuation("{");
                writeSpace();
                writeKeyword("assert");
                writePunctuation(":");
                writeSpace();
                const elements = node.assertions.assertClause.elements;
                emitList(node.assertions.assertClause, elements, ListFormat.ImportClauseEntries);
                writeSpace();
                writePunctuation("}");
            }
            writePunctuation(")");
            if (node.qualifier) {
                writePunctuation(".");
                emit(node.qualifier);
            }
            emitTypeArguments(node, node.typeArguments);
        }

        //
        // Binding patterns
        //

        function emitObjectBindingPattern(node: ObjectBindingPattern) {
            writePunctuation("{");
            emitList(node, node.elements, ListFormat.ObjectBindingPatternElements);
            writePunctuation("}");
        }

        function emitArrayBindingPattern(node: ArrayBindingPattern) {
            writePunctuation("[");
            emitList(node, node.elements, ListFormat.ArrayBindingPatternElements);
            writePunctuation("]");
        }

        function emitBindingElement(node: BindingElement) {
            emit(node.dotDotDotToken);
            if (node.propertyName) {
                emit(node.propertyName);
                writePunctuation(":");
                writeSpace();
            }
            emit(node.name);
            emitInitializer(node.initializer, node.name.end, node, parenthesizer.parenthesizeExpressionForDisallowedComma);
        }

        //
        // Expressions
        //
        function emitQJSNewArray() {
            writeQJSBase(generateQJSNewArray());
            writeQJSTrailingSemicolon();
            writeQJSLine();
        }

        function emitQJSArrayLiteralExpression(len: number) {
            if (!printerOptions.emitQJSCode) {
                return;
            }

            const array = prepareQJSTempVar(QJSCType.JSValue, QJSJSType.Object);
            writeQJSKeyword(qjsTypeInfo[QJSCType.JSValue].type);
            writeQJSSpace();
            writeQJSBase(array.name);
            writeQJSSpace();
            writeQJSPunctuation("=");
            writeQJSSpace();
            emitQJSNewArray();

            popQJSValueStack();
            for (let i = len - 1; i >= 0; i --) {
                const val = popQJSValueStack();
                emitQJSDefineArrayElement(array, i, val);
            }
            pushQJSValueStack(array);
        }

        function emitQJSDefineArrayElement(array: QJSVar, index: QJSVar | number, val: QJSVar) {
            let valcode = val.name;
            switch (val.type) {
                case QJSCType.Int:
                case QJSCType.Double:
                case QJSCType.IntLiteral:
                case QJSCType.FloatLiteral:
                    valcode = generateQJSMKVal(val);
                    break;
                default:
                    break;
            }

            let indexCode = "";
            if (typeof index === "number") {
                indexCode = index.toString();
            }
            else {
                switch (index.type) {
                    case QJSCType.JSValue:
                        indexCode = generateQJSJSValueGetInt(index);
                        break;
                    case QJSCType.Int:
                        break;
                    default:
                        Debug.assert("qjs emitter: unexpected index type.");
                        break;
                }
            }
            writeQJSBase(generateQJSDefinePropertyValue(array, "__JS_AtomFromUInt32("+ indexCode + ")",
                valcode, "JS_PROP_C_W_E | JS_PROP_THROW"));
            writeQJSTrailingSemicolon();
            writeQJSLine();

            val.needfree = false;
        }

        function emitArrayLiteralExpression(node: ArrayLiteralExpression) {
            const elements = node.elements;
            const preferNewLine = node.multiLine ? ListFormat.PreferNewLine : ListFormat.None;

            emitExpressionList(node, elements, ListFormat.ArrayLiteralExpressionElements | preferNewLine, parenthesizer.parenthesizeExpressionForDisallowedComma);

            emitQJSArrayLiteralExpression(elements.length);
        }

        function emitQJSNewObject(qjsVar: QJSVar) {
            if (!printerOptions.emitQJSCode) {
                return;
            }

            writeQJSKeyword(qjsVar.name);
            writeQJSSpace();
            writeQJSPunctuation("=");
            writeQJSSpace();
            writeQJSBase(generateQJSNewObject());
            writeQJSTrailingSemicolon();
            writeQJSLine();
        }

        function emitObjectLiteralExpression(node: ObjectLiteralExpression) {
            forEach(node.properties, generateMemberNames);

            if (!!printerOptions.emitQJSCode) {
                forEach(node.properties, generateQJSMemberNames);
                let qjsVar: QJSVar;
                if (node.parent.kind === SyntaxKind.VariableDeclaration) {
                    qjsVar = peekQJSValueStack();
                }
                else {
                    qjsVar = prepareQJSTempVar(QJSCType.JSValue, QJSJSType.Object);
                }
                emitQJSNewObject(qjsVar);

                if (node.parent.kind === SyntaxKind.VariableDeclaration) {
                    pushQJSValueStack(qjsVar);
                }
            }

            const indentedFlag = getEmitFlags(node) & EmitFlags.Indented;
            if (indentedFlag) {
                increaseIndent();
            }

            const preferNewLine = node.multiLine ? ListFormat.PreferNewLine : ListFormat.None;
            const allowTrailingComma = currentSourceFile!.languageVersion >= ScriptTarget.ES5 && !isJsonSourceFile(currentSourceFile!) ? ListFormat.AllowTrailingComma : ListFormat.None;
            emitList(node, node.properties, ListFormat.ObjectLiteralExpressionProperties | allowTrailingComma | preferNewLine);

            if (indentedFlag) {
                decreaseIndent();
            }
        }

        function resolveQJSProperty(node: PropertyAccessExpression, obj: QJSVar, ctype: QJSCType, jstype: QJSJSType) {
            (ctype);
            (jstype);
            const propname = getTextOfNode(node.name);
            if (!qjsAtomMap.get(propname)) {
                const jsName = propname;
                const varAtomName = qjsTypeInfo[QJSCType.JSAtom].prefix + jsName;
                const qjsAtomVar = qjsNewVar(undefined, QJSCType.JSAtom, varAtomName, true, true);
                qjsAtomMap.set(jsName, qjsAtomVar);
            }

            const fullname = generateQJSPropSymbol(obj, propname);
            const qjsJSVarMap = qjsGetCurFrame().jsvarmap;
            let jsvar = qjsJSVarMap.get(fullname);

            if (!jsvar) {
                jsvar = resolveQJSIdentifierInternal(fullname);
                if (jsvar && jsvar.kind === QJSJSVarKind.Prop &&
                    qjsGetCurFunction(jsvar.frame) ===
                    qjsGetCurFunction(qjsGetCurFrame())) {
                    pushQJSValueStack(jsvar.cvar);
                }
                else {
                    const qjsVar = prepareQJSTempVar(QJSCType.JSValue, jstype);
                    jsvar = qjsNewJSVar(generateQJSPropSymbol(obj, propname), jstype, QJSJSVarKind.Prop, qjsVar);
                    emitQJSDeclareQJSVar(qjsVar);
                }
            }
            else {
                pushQJSValueStack(jsvar.cvar);
            }
        }

        function emitQJSPropertyAccessExpression(node: PropertyAccessExpression) {
            if (!printerOptions.emitQJSCode) {
                return;
            }

            let obj = popQJSValueStack();
            if (obj.type === QJSCType.JSValue) {
                if (obj.jsvar &&
                    obj.jsvar.kind === QJSJSVarKind.GlobalVar &&
                    !obj.jsvar.inited) {
                        emitQJSInitGlobalVar(obj);
                    }
            }
            else {
                obj = emitQJSBoxVal(obj);
                //Debug.fail("qjs emitter: unsupported type now.");
            }

            const symbol = checker!.getSymbolAtLocation(node.name);
            const type = checker!.getTypeAtLocation(node.name);

            if (!symbol) {
                // perhaps an extern var, we dont know its definition.
                //Debug.fail("qjs emitter: cannot find the symbol.");
            }

            //if (obj.jstype === QJSJSType.Function) {
            //    popQJSValueStack(); // drop "this" object in the case of Object.method.call(xxx).
            //}

            let jstype = QJSJSType.Undefined;
            let ctype = QJSCType.JSValue;
            if (!!symbol && symbol.flags & SymbolFlags.Property) {
                if (type.flags & TypeFlags.Number) {
                    ctype = QJSCType.Number;
                    jstype = QJSJSType.Float64;
                }
                else if (type.flags & TypeFlags.Object) {
                    ctype = QJSCType.JSValue;
                    jstype = QJSJSType.Object;
                }
                resolveQJSProperty(node, obj, ctype, jstype);
                const prop = peekQJSValueStack();
                if (qjsEmitterState === QJSValueStackState.RValue &&
                    !prop.jsvar!.inited) {
                    emitQJSGetProperty(prop);
                }
            }
            else if (!!symbol && symbol.flags & SymbolFlags.Method) {
                jstype = QJSJSType.Function;
                ctype = QJSCType.JSValue;

                if (node.parent.kind === SyntaxKind.CallExpression) {
                    // push "this" object.
                    pushQJSValueStack(obj);
                }

                resolveQJSProperty(node, obj, ctype, jstype);
                if (!qjsConfig.enableLazyInitMethod) {
                    const prop = popQJSValueStack();
                    const qjsVar = emitQJSGetProperty(prop);
                    pushQJSValueStack(qjsVar);
                }
            }
            else  if (!symbol) {
                ctype = QJSCType.JSValue;
                jstype = QJSJSType.Any;

                resolveQJSProperty(node, obj, ctype, jstype);
                const prop = peekQJSValueStack();
                if (qjsEmitterState === QJSValueStackState.RValue &&
                    !prop.jsvar!.inited) {
                    emitQJSGetProperty(prop);
                }
            }
            else {
                Debug.fail("qjs emitter: unsupported type in emitQJSPropertyAccessExpression");
            }

            return;
/*
            const propname = getTextOfNode(node.name);

            const qjsJSVarMap = qjsGetCurFrame().jsvarmap;
            let jsvar = qjsJSVarMap.get(generateQJSPropSymbol(obj, propname));
            let retVal: QJSVar;
            if (!jsvar) {
                const qjsVar = prepareQJSTempVar(QJSCType.JSValue, jstype);
                jsvar = qjsNewJSVar(generateQJSPropSymbol(obj, propname), jstype, QJSJSVarKind.Prop, qjsVar);
                emitQJSDeclareQJSVar(qjsVar);

            }
            else {
                retVal = jsvar.cvar;
                pushQJSValueStack(retVal);
            }
*/
        }

        function emitPropertyAccessExpression(node: PropertyAccessExpression) {
            emitExpression(node.expression, parenthesizer.parenthesizeLeftSideOfAccess);
            const token = node.questionDotToken || setTextRangePosEnd(factory.createToken(SyntaxKind.DotToken) as DotToken, node.expression.end, node.name.pos);
            const linesBeforeDot = getLinesBetweenNodes(node, node.expression, token);
            const linesAfterDot = getLinesBetweenNodes(node, token, node.name);

            writeLinesAndIndent(linesBeforeDot, /*writeSpaceIfNotIndenting*/ false);

            const shouldEmitDotDot =
                token.kind !== SyntaxKind.QuestionDotToken &&
                mayNeedDotDotForPropertyAccess(node.expression) &&
                !writer.hasTrailingComment() &&
                !writer.hasTrailingWhitespace();

            if (shouldEmitDotDot) {
                writePunctuation(".");
            }

            if (node.questionDotToken) {
                emit(token);
            }
            else {
                emitTokenWithComment(token.kind, node.expression.end, writePunctuation, node);
            }
            writeLinesAndIndent(linesAfterDot, /*writeSpaceIfNotIndenting*/ false);
            emit(node.name);

            emitQJSPropertyAccessExpression(node);

            decreaseIndentIf(linesBeforeDot, linesAfterDot);
        }

        // 1..toString is a valid property access, emit a dot after the literal
        // Also emit a dot if expression is a integer const enum value - it will appear in generated code as numeric literal
        function mayNeedDotDotForPropertyAccess(expression: Expression) {
            expression = skipPartiallyEmittedExpressions(expression);
            if (isNumericLiteral(expression)) {
                // check if numeric literal is a decimal literal that was originally written with a dot
                const text = getLiteralTextOfNode(expression as LiteralExpression, /*neverAsciiEscape*/ true, /*jsxAttributeEscape*/ false);
                // If he number will be printed verbatim and it doesn't already contain a dot, add one
                // if the expression doesn't have any comments that will be emitted.
                return !expression.numericLiteralFlags && !stringContains(text, tokenToString(SyntaxKind.DotToken)!);
            }
            else if (isAccessExpression(expression)) {
                // check if constant enum value is integer
                const constantValue = getConstantValue(expression);
                // isFinite handles cases when constantValue is undefined
                return typeof constantValue === "number" && isFinite(constantValue)
                    && Math.floor(constantValue) === constantValue;
            }
        }

        function emitQJSElementAccessInternal(node: ElementAccessExpression, array: QJSVar, index: QJSVar) {
            // object symbol
            const symbol = checker!.getSymbolAtLocation(node.expression);
            // result type
            const type = checker!.getTypeAtLocation(node);

            // key symbol
            //const symbolKey = checker!.getSymbolAtLocation(node.argumentExpression);
            // key type
            const typeKey = checker!.getTypeAtLocation(node.argumentExpression);

            if (!symbol) {
                Debug.fail("qjs emitter: cannot find the symbol.");
            }

            //if (!symbolKey) {
            //    Debug.fail("qjs emitter: cannot find the key symbol.");
            //}

            let jstype = QJSJSType.Undefined;
            let ctype = QJSCType.JSValue;
            if (type.flags & TypeFlags.Number) {
                ctype = QJSCType.JSValue;
                jstype = QJSJSType.Float64;
            }
            else if (type.flags & TypeFlags.String) {
                ctype = QJSCType.JSValue;
                jstype = QJSJSType.String;
            }
            else {
                Debug.fail("qjs emitter: unsupported type now.");
            }

            Debug.assert(qjsEmitterState !== QJSValueStackState.LValue);
            if (typeKey.flags & TypeFlags.NumberLiteral) {
                const ret = prepareQJSTempVar(ctype, jstype);
                writeQJSKeyword(qjsTypeInfo[ctype].type);
                writeQJSSpace();
                index.jstype = QJSJSType.NumLiteral;
                if (index.jsvar) {
                    index.jsvar.type = index.jstype;
                }
                emitQJSGetElement(array, index, ret);
            }
            else if (typeKey.flags & TypeFlags.Number) {
                const ret = prepareQJSTempVar(ctype, jstype);
                writeQJSKeyword(qjsTypeInfo[ctype].type);
                writeQJSSpace();
                index.jstype = QJSJSType.Float64;
                if (index.jsvar) {
                    index.jsvar.type = index.jstype;
                }
                emitQJSGetElement(array, index, ret);
            }
            else if (typeKey.flags & TypeFlags.String) {
                const ret = prepareQJSTempVar(ctype, jstype);
                writeQJSKeyword(qjsTypeInfo[ctype].type);
                writeQJSSpace();
                index.jstype = QJSJSType.String;
                if (index.jsvar) {
                    index.jsvar.type = index.jstype;
                }
                emitQJSGetElement(array, index, ret);
            }
        }

        function emitQJSElementAccessExpression(node: ElementAccessExpression) {
            if (!printerOptions.emitQJSCode) {
                return;
            }

            const index = popQJSValueStack();
            const array = popQJSValueStack();

            if (qjsEmitterState === QJSValueStackState.LValue) {
                pushQJSValueStack(array);
                pushQJSValueStack(index);
            }
            else {
                emitQJSElementAccessInternal(node, array, index);
            }
        }

        function emitElementAccessExpression(node: ElementAccessExpression) {
            const savedEmitterState = qjsEmitterState;
            qjsEmitterState = QJSValueStackState.RValue;
            emitExpression(node.expression, parenthesizer.parenthesizeLeftSideOfAccess);

            emit(node.questionDotToken);
            emitTokenWithComment(SyntaxKind.OpenBracketToken, node.expression.end, writePunctuation, node);

            qjsEmitterState = QJSValueStackState.RValue;
            emitExpression(node.argumentExpression);

            qjsEmitterState = savedEmitterState;
            emitQJSElementAccessExpression(node);
            emitTokenWithComment(SyntaxKind.CloseBracketToken, node.argumentExpression.end, writePunctuation, node);
        }

        function emitQJSFunctionCall(node: CallExpression) {
            if (!printerOptions.emitQJSCode) {
                return;
            }

            const count = node.arguments.length;
            const symbol = checker!.getSymbolAtLocation(node.expression);

            const type = checker!.getTypeAtLocation(node.expression);
            const signature = checker!.getSignaturesOfType(type, SignatureKind.Call);
            const retType = checker!.getReturnTypeOfSignature(signature[0]); //there could be multiple signatures.

            if (!symbol) {
                Debug.fail("qjs emitter: cannot find the symbol.");
            }

            let args = "";
            const freeArgsList: QJSVar[] = [];
            if (count === 0) {
                args = QJSReserved.NULL;
            }
            else if (count > 1 || !qjsConfig.enableOneArgumentFunctionCall) {
                writeQJSKeyword(qjsTypeInfo[QJSCType.JSValue].type);
                writeQJSSpace();
                const argvName = generateQJSTempVarName(QJSCType.JSValue);
                writeQJSBase(argvName);
                writeQJSPunctuation("[");
                writeQJSKeyword(count.toString());
                writeQJSPunctuation("]");
                writeQJSTrailingSemicolon();
                writeQJSLine();

                let index = 0;
                for (const _ of node.arguments) {
                    const val = popQJSValueStack();
                    /*
                    if (arg.jsvar || arg.type === QJSCType.JSValue) {
                        args += arg.name;
                    }
                    else {
                        args += generateQJSMKVal(arg);
                    }
                    if (param !== node.arguments[count - 1]) {
                        args += ", ";
                    }
                    */
                    let valcode = "";
                    if (val.jstype === QJSJSType.NumLiteral ||
                        val.type === QJSCType.Int ||
                        val.type === QJSCType.Double ||
                        val.type === QJSCType.Bool) {
                        valcode = generateQJSMKVal(val);
                    }
                    else if (val.type === QJSCType.JSValue) {
                        valcode = generateQJSDupValue(val);
                    }
                    else {
                        Debug.fail("qjs emitter: unsuported type now.");
                    }
                    const argId = node.arguments.length - index - 1;
                    const argName = argvName + "[" + argId.toString() + "]";
                    writeQJSBase(argName);
                    writeQJSSpace();
                    writeQJSPunctuation("=");
                    writeQJSSpace();
                    writeQJSBase(valcode);
                    writeQJSTrailingSemicolon();
                    writeQJSLine();

                    const newVar = qjsNewVar(undefined, QJSCType.JSValue, argName);
                    if (val.type === QJSCType.Int ||
                        val.type === QJSCType.Double ||
                        val.type === QJSCType.Bool ||
                        val.jstype === QJSJSType.NumLiteral ||
                        val.jstype === QJSJSType.Bool) {
                        newVar.jstype = val.jstype;
                        newVar.needfree = false;
                    }

                    if (newVar.type === QJSCType.JSValue) {
                        freeArgsList.push(newVar);
                    }
                    index ++;
                }

                args = argvName;
            }
            else {
                writeQJSKeyword(qjsTypeInfo[QJSCType.JSValue].type);
                writeQJSSpace();
                const argvName = generateQJSTempVarName(QJSCType.JSValue);
                writeQJSBase(argvName);
                writeQJSSpace();
                writeQJSPunctuation("=");
                writeQJSSpace();

                let valcode = "";
                let needfree = false;
                const arg = popQJSValueStack();
                if (arg.jstype === QJSJSType.NumLiteral ||
                    arg.type === QJSCType.Int ||
                    arg.type === QJSCType.Double) {
                    if (arg.type === QJSCType.JSValue) {
                        valcode = arg.name;
                    }
                    else {
                        valcode = generateQJSMKVal(arg);
                    }
                }
                else if (arg.jstype === QJSJSType.Bool ||
                    arg.jstype === QJSJSType.Int32 ||
                    arg.jstype === QJSJSType.Float64) {
                    valcode = arg.name;
                }
                else if (arg.type === QJSCType.JSValue) {
                    valcode = generateQJSDupValue(arg);
                    needfree = true;
                }
                else {
                    Debug.fail("qjs emitter: unsuported type now.");
                }

                writeQJSBase(valcode);
                writeQJSTrailingSemicolon();
                writeQJSLine();

                qjsNewVar(undefined, QJSCType.JSValue, argvName, needfree);

                args = "&" + argvName;
            }

            qjsWriteBackObjects();

            const func = popQJSValueStack();

            if (func.jsvar &&
                !func.jsvar.inited) {
                if (func.jsvar.kind === QJSJSVarKind.GlobalVar) {
                    emitQJSInitGlobalVar(func);
                }
                else if (func.jsvar.kind === QJSJSVarKind.Prop) {
                    emitQJSInitProp(func);
                }
            }

            let jsType = QJSJSType.Unknown;
            if (retType.flags & TypeFlags.Number) {
                jsType = QJSJSType.Float64;
            }
            else if (retType.flags & TypeFlags.String) {
                jsType = QJSJSType.String;
            }
            else if (retType.flags & TypeFlags.Boolean) {
                jsType = QJSJSType.Bool;
            }
            else if (retType.flags & TypeFlags.Object) {
                jsType = QJSJSType.Object;
            }
            else if (retType.flags & TypeFlags.TypeParameter) {
                jsType = QJSJSType.Any;
            }
            else if (!(retType.flags & TypeFlags.Void)) {
                Debug.fail("qjs emitter: unsupported ret type right now.");
            }

            let thisObj: string = QJSReserved.JSUndefined;
            let emitFunc;
            if (func.jsvar && (func.jsvar.flags & QJSJSVarFlags.isJSCFunction)) {
                emitFunc = emitQJSCallJscFunction;
            }
            else if (node.expression.kind === SyntaxKind.PropertyAccessExpression) {
                const thisObjVar = popQJSValueStack();
                thisObj = thisObjVar.name;
                emitFunc = emitQJSCallFunction;
            }
            else {
                emitFunc = emitQJSCallFunction;
            }

            if (!(retType.flags & TypeFlags.Void)) {
                // return value
                const retVar = prepareQJSTempVar(QJSCType.JSValue, jsType);

                //const cfuncName = QJSReserved.FuncPrefix + funcName.jsvar!.name;
                writeQJSKeyword(qjsTypeInfo[QJSCType.JSValue].type);
                writeQJSSpace();
                writeQJSKeyword(retVar.name);
                writeQJSSpace();
                writeQJSPunctuation("=");
                writeQJSSpace();
            }

            emitFunc();
/*
            if (count > 1 || !qjsConfig.enableOneArgumentFunctionCall) {
                freeArgsList.forEach((value) => {
                    emitQJSFreeValue(value);
                });
            }
*/
            qjsResetObjects();

            function emitQJSCallJscFunction() {
                writeQJSKeyword(QJSFunction.JS_Call_jsc);
                writeQJSPunctuation("(");
                writeQJSKeyword(QJSReserved.DefaultCtx);
                writeQJSPunctuation(",");
                writeQJSSpace();
                writeQJSKeyword(func.name);
                writeQJSPunctuation(",");
                writeQJSSpace();
                writeQJSKeyword(thisObj);
                writeQJSPunctuation(",");
                writeQJSSpace();
                writeQJSBase(count.toString());
                writeQJSPunctuation(",");
                writeQJSSpace();
                writeQJSBase(args);
                writeQJSPunctuation(")");
                //writeQJSPunctuation(", 2)");
                writeQJSTrailingSemicolon();
                writeQJSLine(2);
            }

            function emitQJSCallFunction() {
                writeQJSKeyword(QJSFunction.JS_Call);
                writeQJSPunctuation("(");
                writeQJSKeyword(QJSReserved.DefaultCtx);
                writeQJSPunctuation(",");
                writeQJSSpace();
                writeQJSKeyword(func.name);
                writeQJSPunctuation(",");
                writeQJSSpace();
                writeQJSKeyword(thisObj);
                writeQJSPunctuation(",");
                writeQJSSpace();
                writeQJSBase(count.toString());
                writeQJSPunctuation(",");
                writeQJSSpace();
                writeQJSBase(args);
                writeQJSPunctuation(")");
                writeQJSTrailingSemicolon();
                writeQJSLine(2);
            }
        }

        function emitCallExpression(node: CallExpression) {
            const indirectCall = getEmitFlags(node) & EmitFlags.IndirectCall;
            if (indirectCall) {
                writePunctuation("(");
                writeLiteral("0");
                writePunctuation(",");
                writeSpace();
            }
            emitExpression(node.expression, parenthesizer.parenthesizeLeftSideOfAccess);
            if (indirectCall) {
                writePunctuation(")");
            }
            emit(node.questionDotToken);
            emitTypeArguments(node, node.typeArguments);
            qjsEmitterState = QJSValueStackState.RValue;
            emitExpressionList(node, node.arguments, ListFormat.CallExpressionArguments, parenthesizer.parenthesizeExpressionForDisallowedComma);
            emitQJSFunctionCall(node);
        }

        function emitQJSNewExpression(node: NewExpression) {
            if (!printerOptions.emitQJSCode) {
                return;
            }

            const count = node.arguments ? node.arguments.length : 0;
            const symbol = checker!.getSymbolAtLocation(node.expression);

            const type = checker!.getTypeAtLocation(node.expression);
            const signature = checker!.getSignaturesOfType(type, SignatureKind.Call);
            const retType = checker!.getReturnTypeOfSignature(signature[0]);

            Debug.assert(retType.flags & TypeFlags.Object);

            if (!symbol) {
                Debug.fail("qjs emitter: cannot find the symbol.");
            }

            let args = "";
            const freeArgsList: QJSVar[] = [];
            if (count === 0) {
                args = QJSReserved.NULL;
            }
            else {
                writeQJSKeyword(qjsTypeInfo[QJSCType.JSValue].type);
                writeQJSSpace();
                const argvName = generateQJSTempVarName(QJSCType.JSValue);
                writeQJSBase(argvName);
                writeQJSPunctuation("[");
                writeQJSKeyword(count.toString());
                writeQJSPunctuation("]");
                writeQJSTrailingSemicolon();
                writeQJSLine();

                let index = 0;
                for (const _ of node.arguments!) {
                    const val = popQJSValueStack();
                    let valcode = "";
                    if (val.jstype === QJSJSType.NumLiteral ||
                        val.type === QJSCType.Int ||
                        val.type === QJSCType.Double ||
                        val.type === QJSCType.Bool) {
                        valcode = generateQJSMKVal(val);
                    }
                    else if (val.type === QJSCType.JSValue) {
                        valcode = generateQJSDupValue(val);
                    }
                    else {
                        Debug.fail("qjs emitter: unsuported type now.");
                    }
                    const argId = node.arguments!.length - index - 1;
                    const argName = argvName + "[" + argId.toString() + "]";
                    writeQJSBase(argName);
                    writeQJSSpace();
                    writeQJSPunctuation("=");
                    writeQJSSpace();
                    writeQJSBase(valcode);
                    writeQJSTrailingSemicolon();
                    writeQJSLine();

                    const newVar = qjsNewVar(undefined, QJSCType.JSValue, argName);
                    if (val.type === QJSCType.Int ||
                        val.type === QJSCType.Double ||
                        val.type === QJSCType.Bool ||
                        val.jstype === QJSJSType.NumLiteral ||
                        val.jstype === QJSJSType.Bool) {
                        newVar.jstype = val.jstype;
                        newVar.needfree = false;
                    }

                    if (newVar.type === QJSCType.JSValue) {
                        freeArgsList.push(newVar);
                    }
                    index ++;
                }

                args = argvName;
            }

            qjsWriteBackObjects();

            const func = popQJSValueStack();

            if (func.jsvar &&
                !func.jsvar.inited) {
                if (func.jsvar.kind === QJSJSVarKind.GlobalVar) {
                    emitQJSInitGlobalVar(func);
                }
                else {
                    Debug.fail("qjs emitter: unsuported now.");
                }
            }

            const jsType = QJSJSType.Object;
            const emitFunc =  emitQJSCallCtorFunction;

            const retVar = prepareQJSTempVar(QJSCType.JSValue, jsType);

            //const cfuncName = QJSReserved.FuncPrefix + funcName.jsvar!.name;
            writeQJSKeyword(qjsTypeInfo[QJSCType.JSValue].type);
            writeQJSSpace();
            writeQJSKeyword(retVar.name);
            writeQJSSpace();
            writeQJSPunctuation("=");
            writeQJSSpace();

            emitFunc();

            qjsResetObjects();

            function emitQJSCallCtorFunction() {
                writeQJSKeyword(QJSFunction.JS_CallConstructor);
                writeQJSPunctuation("(");
                writeQJSKeyword(QJSReserved.DefaultCtx);
                writeQJSPunctuation(",");
                writeQJSSpace();
                writeQJSKeyword(func.name);
                writeQJSPunctuation(",");
                writeQJSSpace();
                writeQJSBase(count.toString());
                writeQJSPunctuation(",");
                writeQJSSpace();
                writeQJSBase(args);
                writeQJSPunctuation(")");
                writeQJSTrailingSemicolon();
                writeQJSLine(2);
            }

        }

        function emitNewExpression(node: NewExpression) {
            emitTokenWithComment(SyntaxKind.NewKeyword, node.pos, writeKeyword, node);
            writeSpace();
            emitExpression(node.expression, parenthesizer.parenthesizeExpressionOfNew);
            emitTypeArguments(node, node.typeArguments);
            emitExpressionList(node, node.arguments, ListFormat.NewExpressionArguments, parenthesizer.parenthesizeExpressionForDisallowedComma);
            emitQJSNewExpression(node);
        }

        function emitTaggedTemplateExpression(node: TaggedTemplateExpression) {
            const indirectCall = getEmitFlags(node) & EmitFlags.IndirectCall;
            if (indirectCall) {
                writePunctuation("(");
                writeLiteral("0");
                writePunctuation(",");
                writeSpace();
            }
            emitExpression(node.tag, parenthesizer.parenthesizeLeftSideOfAccess);
            if (indirectCall) {
                writePunctuation(")");
            }
            emitTypeArguments(node, node.typeArguments);
            writeSpace();
            emitExpression(node.template);
        }

        function emitTypeAssertionExpression(node: TypeAssertion) {
            writePunctuation("<");
            emit(node.type);
            writePunctuation(">");
            emitExpression(node.expression, parenthesizer.parenthesizeOperandOfPrefixUnary);
        }

        function emitParenthesizedExpression(node: ParenthesizedExpression) {
            const openParenPos = emitTokenWithComment(SyntaxKind.OpenParenToken, node.pos, writePunctuation, node);
            const indented = writeLineSeparatorsAndIndentBefore(node.expression, node);
            emitExpression(node.expression, /*parenthesizerRules*/ undefined);
            writeLineSeparatorsAfter(node.expression, node);
            decreaseIndentIf(indented);
            emitTokenWithComment(SyntaxKind.CloseParenToken, node.expression ? node.expression.end : openParenPos, writePunctuation, node);
        }

        function emitFunctionExpression(node: FunctionExpression) {
            generateNameIfNeeded(node.name);
            emitFunctionDeclarationOrExpression(node);
        }

        function emitArrowFunction(node: ArrowFunction) {
            emitDecorators(node, node.decorators);
            emitModifiers(node, node.modifiers);
            emitSignatureAndBody(node, emitArrowFunctionHead);
        }

        function emitArrowFunctionHead(node: ArrowFunction) {
            emitTypeParameters(node, node.typeParameters);
            emitParametersForArrow(node, node.parameters);
            emitTypeAnnotation(node.type);
            writeSpace();
            emit(node.equalsGreaterThanToken);
        }

        function emitDeleteExpression(node: DeleteExpression) {
            emitTokenWithComment(SyntaxKind.DeleteKeyword, node.pos, writeKeyword, node);
            writeSpace();
            emitExpression(node.expression, parenthesizer.parenthesizeOperandOfPrefixUnary);
        }

        function emitTypeOfExpression(node: TypeOfExpression) {
            emitTokenWithComment(SyntaxKind.TypeOfKeyword, node.pos, writeKeyword, node);
            writeSpace();
            emitExpression(node.expression, parenthesizer.parenthesizeOperandOfPrefixUnary);
        }

        function emitVoidExpression(node: VoidExpression) {
            emitTokenWithComment(SyntaxKind.VoidKeyword, node.pos, writeKeyword, node);
            writeSpace();
            emitExpression(node.expression, parenthesizer.parenthesizeOperandOfPrefixUnary);
        }

        function emitAwaitExpression(node: AwaitExpression) {
            emitTokenWithComment(SyntaxKind.AwaitKeyword, node.pos, writeKeyword, node);
            writeSpace();
            emitExpression(node.expression, parenthesizer.parenthesizeOperandOfPrefixUnary);
        }

        function emitQJSExclamationExpression() {
            const val = popQJSValueStack();

            const ret = prepareQJSTempVar(QJSCType.Bool, QJSJSType.Bool);
            writeQJSKeyword(qjsTypeInfo[ret.type].type);
            writeQJSSpace();
            writeQJSKeyword(ret.name);
            writeQJSSpace();
            writeQJSPunctuation("=");
            writeQJSSpace();

            if (val.type === QJSCType.Int ||
                val.type === QJSCType.Bool) {
                writeQJSPunctuation("!");
                writeQJSKeyword(val.name);
            }
            else if (val.type === QJSCType.JSValue) {
                if (val.jstype === QJSJSType.Bool ||
                    val.jstype === QJSJSType.Int32) {
                    writeQJSBase(generateQJSJSValueGetInt(val));
                    writeQJSBase(" == 0");
                }
                else {
                    writeQJSPunctuation("!");
                    writeQJSBase(generateQJSJSToBool(val));
                }
            }
            else {
                Debug.fail("qjs emitter: unsupported exclamation type right now.");
            }

            writeQJSTrailingSemicolon();
            writeQJSLine();
        }

        function emitQJSPlusPlusExpression() {
            const val = popQJSValueStack();

            function generateQJSIncNumFunc(func: string, val: string) {
                return func + "(ctx, " + val + ")";
            }

            if (val.type === QJSCType.JSValue) {
                if (val.jstype === QJSJSType.Int32 ||
                    val.jstype === QJSJSType.NumLiteral ||
                    val.jstype === QJSJSType.Float64) {
                    writeQJSBase(generateQJSIncNumFunc(QJSFunction.JS_IncInt, "&" + val.name));
                }
                else {
                    Debug.fail("qjs emitter: unsupported plusplus type right now.");
                }
            }
            else {
                Debug.fail("qjs emitter: unsupported plusplus type right now.");
            }

            writeQJSTrailingSemicolon();
            writeQJSLine();

            if (qjsEmitterState !== QJSValueStackState.None) {
                pushQJSValueStack(val);
            }
        }

        function emitQJSPrefixUnaryExpression(node: PrefixUnaryExpression) {
            if (!printerOptions.emitQJSCode) {
                return;
            }

            switch(node.operator) {
                case SyntaxKind.ExclamationToken:
                    emitQJSExclamationExpression();
                    break;
                case SyntaxKind.PlusPlusToken:
                    emitQJSPlusPlusExpression();
                    break;
                default:
                    Debug.fail("qjs emitter: unsupported prefix unary token right now.");
                    break;
            }
        }

        function emitPrefixUnaryExpression(node: PrefixUnaryExpression) {
            writeTokenText(node.operator, writeOperator);
            if (shouldEmitWhitespaceBeforeOperand(node)) {
                writeSpace();
            }
            emitExpression(node.operand, parenthesizer.parenthesizeOperandOfPrefixUnary);
            emitQJSPrefixUnaryExpression(node);
        }

        function shouldEmitWhitespaceBeforeOperand(node: PrefixUnaryExpression) {
            // In some cases, we need to emit a space between the operator and the operand. One obvious case
            // is when the operator is an identifier, like delete or typeof. We also need to do this for plus
            // and minus expressions in certain cases. Specifically, consider the following two cases (parens
            // are just for clarity of exposition, and not part of the source code):
            //
            //  (+(+1))
            //  (+(++1))
            //
            // We need to emit a space in both cases. In the first case, the absence of a space will make
            // the resulting expression a prefix increment operation. And in the second, it will make the resulting
            // expression a prefix increment whose operand is a plus expression - (++(+x))
            // The same is true of minus of course.
            const operand = node.operand;
            return operand.kind === SyntaxKind.PrefixUnaryExpression
                && ((node.operator === SyntaxKind.PlusToken && ((operand as PrefixUnaryExpression).operator === SyntaxKind.PlusToken || (operand as PrefixUnaryExpression).operator === SyntaxKind.PlusPlusToken))
                    || (node.operator === SyntaxKind.MinusToken && ((operand as PrefixUnaryExpression).operator === SyntaxKind.MinusToken || (operand as PrefixUnaryExpression).operator === SyntaxKind.MinusMinusToken)));
        }

        function emitPostfixUnaryExpression(node: PostfixUnaryExpression) {
            emitExpression(node.operand, parenthesizer.parenthesizeOperandOfPostfixUnary);
            writeTokenText(node.operator, writeOperator);
        }

        function emitQJSBinaryExpressionCompBothNumLiteral(qjsLeft: QJSVar, qjsRight: QJSVar, operator: SyntaxKind) {
            const retVar = prepareQJSTempVar(QJSCType.Bool, QJSJSType.Bool);

            switch (operator) {
                case SyntaxKind.LessThanEqualsToken:
                {
                    const ret = ((+qjsLeft.value!) <= (+qjsRight.value!));
                    retVar.value = ret.toString();
                }
                    break;
                case SyntaxKind.EqualsEqualsEqualsToken:
                {
                    const ret = ((+qjsLeft.value!) === (+qjsRight.value!));
                    retVar.value = ret.toString();
                }
                    break;
                default:
                    Debug.log(`QJS emitter: unsupported binary expression operator ${operator}.`);
                    break;
            }

            writeQJSKeyword(qjsTypeInfo[QJSCType.Bool].type);
            writeQJSSpace();
            writeQJSKeyword(retVar.name);
            writeQJSSpace();
            writeQJSOperator("=");
            writeQJSSpace();
            writeQJSBase(retVar.value!);
            writeQJSTrailingSemicolon();
            writeQJSLine(2);
        }

        function emitQJSBinaryExpressionCompBothInt(qjsLeft: QJSVar, qjsRight: QJSVar, operator: SyntaxKind) {
            const retVar = prepareQJSTempVar(QJSCType.Bool, QJSJSType.Bool);

            const valLeft = qjsLeft.type === QJSCType.JSValue ? generateQJSJSValueGetInt(qjsLeft) : qjsLeft.name;
            const valRight = qjsRight.type === QJSCType.JSValue ? generateQJSJSValueGetInt(qjsRight) : qjsRight.name;

            let token: string;
            switch (operator) {
                case SyntaxKind.LessThanEqualsToken:
                    token = QJSReserved.LTEToken;
                    break;
                case SyntaxKind.LessThanToken:
                    token = QJSReserved.LTEToken;
                    break;
                case SyntaxKind.EqualsEqualsEqualsToken:
                    token = QJSReserved.EqualsEqualsToken;
                    break;
                default:
                    Debug.log(`QJS emitter: unsupported binary expression operator ${operator}.`);
                    token = "??";
                    break;

            }

            writeQJSKeyword(qjsTypeInfo[QJSCType.Bool].type);
            writeQJSSpace();
            writeQJSKeyword(retVar.name);
            writeQJSSpace();
            writeQJSOperator("=");
            writeQJSSpace();
            writeQJSPunctuation("(");
            writeQJSBase(valLeft);
            writeQJSSpace();
            writeQJSBase(token);
            writeQJSSpace();
            writeQJSBase(valRight);
            writeQJSPunctuation(")");
            writeQJSTrailingSemicolon();
            writeQJSLine(2);
        }

        function generateQJSCompareFunc(func: QJSFunction, ret: QJSVar, left: QJSVar, right: QJSVar, op: SyntaxKind): string {
            let token: string;
            switch (op) {
                case SyntaxKind.LessThanEqualsToken:
                    token = QJSReserved.LTEToken;
                    break;
                case SyntaxKind.LessThanToken:
                    token = QJSReserved.LTToken;
                    break;
                case SyntaxKind.EqualsEqualsEqualsToken:
                    token = QJSReserved.EqualsEqualsToken;
                    break;
                default:
                    Debug.log(`QJS emitter: unsupported binary expression operator ${op}.`);
                    token = "??";
                    break;

            }
            return func + "(" + ret.name + ", " + left.name + ", " + right.name + ", " + token + ")";
        }

        function emitQJSBinaryExpressionCompNumSlowPath(qjsLeft: QJSVar, qjsRight: QJSVar, operator: SyntaxKind) {
            const retVar = prepareQJSTempVar(QJSCType.Bool, QJSJSType.Bool);
            writeQJSKeyword(qjsTypeInfo[QJSCType.Bool].type);
            writeQJSSpace();
            writeQJSKeyword(retVar.name);
            writeQJSTrailingSemicolon();
            writeQJSLine();

            if (qjsLeft.type === QJSCType.JSValue &&
                qjsRight.type === QJSCType.JSValue) {
                writeQJSBase(generateQJSCompareFunc(QJSFunction.JS_COMPARE_NUMBER_NUMBER, retVar, qjsLeft, qjsRight, operator));
            }
            else if (qjsLeft.type === QJSCType.JSValue) {
                writeQJSBase(generateQJSCompareFunc(QJSFunction.JS_COMPARE_NUMBER_INT, retVar, qjsLeft, qjsRight, operator));
            }
            else {
                writeQJSBase(generateQJSCompareFunc(QJSFunction.JS_COMPARE_INT_NUMBER, retVar, qjsLeft, qjsRight, operator));
            }

            writeQJSTrailingSemicolon();
            writeQJSLine(2);
        }

        function generateQJSLogicOperator(operator: SyntaxKind): string {
            switch (operator) {
                case SyntaxKind.AmpersandAmpersandToken:
                    return "&&";
                    break;
                default:
                    break;
            }

            return "";
        }

        function emitQJSBinaryExpressionLogic(operator: SyntaxKind) {
            const qjsRight = popQJSValueStack();
            const qjsLeft = popQJSValueStack();

            const ret = prepareQJSTempVar(QJSCType.Bool, QJSJSType.Bool);
            writeQJSKeyword(qjsTypeInfo[QJSCType.Bool].type);
            writeQJSSpace();
            writeQJSBase(ret.name);
            writeQJSSpace();
            writeQJSPunctuation("=");
            writeQJSSpace();

            if (qjsLeft.type === QJSCType.Bool) {
                writeQJSBase(qjsLeft.name);
            }
            else if (qjsLeft.type === QJSCType.JSValue) {
                writeQJSBase(generateQJSJSValueGetBool(qjsLeft));
            }
            else {
                Debug.fail("qjs emitter: unexpected type.");
            }

            writeQJSSpace();
            writeQJSBase(generateQJSLogicOperator(operator));
            writeQJSSpace();

            if (qjsRight.type === QJSCType.Bool) {
                writeQJSBase(qjsRight.name);
            }
            else if (qjsRight.type === QJSCType.JSValue) {
                writeQJSBase(generateQJSJSValueGetBool(qjsRight));
            }
            else {
                Debug.fail("qjs emitter: unexpected type.");
            }

            writeQJSTrailingSemicolon();
            writeQJSLine();
        }

        function emitQJSBinaryExpressionCompNum(operator: SyntaxKind) {
            const qjsRight = popQJSValueStack();
            const qjsLeft = popQJSValueStack();

            if (qjsRight.type === QJSCType.JSValue ||
                qjsLeft.type === QJSCType.JSValue) {
                // JSValue
                if (qjsRight.jstype === QJSJSType.Int32 &&
                    qjsLeft.jstype === QJSJSType.Int32) {
                    emitQJSBinaryExpressionCompBothInt(qjsLeft, qjsRight, operator);
                }
                else {
                    emitQJSBinaryExpressionCompNumSlowPath(qjsLeft, qjsRight, operator);
                }
            }
            else {
                // raw data
                if (qjsLeft.jsvar) {
                    //it's a JS var.
                    if (qjsLeft.jstype === qjsRight.jstype) {
                        switch (qjsRight.jstype) {
                            case QJSJSType.NumLiteral:
                                emitQJSBinaryExpressionCompBothNumLiteral(qjsLeft, qjsRight, operator);
                                break;
                            case QJSJSType.Int32:
                                emitQJSBinaryExpressionCompBothInt(qjsLeft, qjsRight, operator);
                                break;
                            case QJSJSType.Float64:
                                break;
                            default:
                                Debug.fail(`QJS emitter: unsupported type in emitQJSBinaryExpressionComp.`);
                                break;
                        }

                    }
                    else {
                        emitQJSBinaryExpressionCompNumSlowPath(qjsLeft, qjsRight, operator);
                    }
                }
                else {
                    if (qjsLeft.jstype === qjsRight.jstype) {
                        switch (qjsRight.jstype) {
                            case QJSJSType.NumLiteral:
                                emitQJSBinaryExpressionCompBothNumLiteral(qjsLeft, qjsRight, operator);
                                break;
                            case QJSJSType.Int32:
                                emitQJSBinaryExpressionCompBothInt(qjsLeft, qjsRight, operator);
                                break;
                            case QJSJSType.Float64:
                                break;
                            default:
                                Debug.fail(`QJS emitter: unsupported type in emitQJSBinaryExpressionComp.`);
                                break;
                        }
                    }
                    else {
                        emitQJSBinaryExpressionCompNumSlowPath(qjsLeft, qjsRight, operator);
                    }
                }
            }
        }

        function generateQJSJSStrictEQ(left: QJSVar, right: QJSVar): string {
            let leftVar = left.name;
            let rightVar = right.name;
            if (left.type !== QJSCType.JSValue) {
                leftVar = generateQJSMKVal(left);
            }

            if (right.type !== QJSCType.JSValue) {
                rightVar = generateQJSMKVal(right);
            }


            return QJSFunction.JS_StrictEQ + "(ctx, " + leftVar + ", " + rightVar + ")";
        }

        function generateQJSJSForInStart(obj: QJSVar, ret: QJSVar) {
            return QJSFunction.JS_For_In_Start + "(ctx, " + obj.name + ", &" + ret.name + ")";
        }

        function generateQJSJSForInNext(emuObj: QJSVar, val: QJSVar, ret: QJSVar) {
            val.jstype = QJSJSType.Object;
            val.jsvar!.inited = true;
            val.needfree = true;
            return QJSFunction.JS_For_In_Next + "(ctx, " + emuObj.name + ", &" + val.name + ", &" + ret.name +")";
        }

        function emitQJSBinaryExpressionStrictEquals() {
            const qjsRight = popQJSValueStack();
            const qjsLeft = popQJSValueStack();

            if (qjsLeft.type === QJSCType.Int ||
                qjsLeft.type === QJSCType.Double ||
                qjsLeft.type === QJSCType.Number ||
                qjsLeft.type === QJSCType.Bool ||
                qjsLeft.type === QJSCType.IntLiteral ||
                qjsLeft.type === QJSCType.FloatLiteral ||
                qjsLeft.jstype === QJSJSType.Int32 ||
                qjsLeft.jstype === QJSJSType.Float64 ||
                qjsLeft.jstype === QJSJSType.Bool ||
                qjsLeft.jstype === QJSJSType.NumLiteral) {
                pushQJSValueStack(qjsLeft);
                pushQJSValueStack(qjsRight);
                emitQJSBinaryExpressionCompNum(SyntaxKind.EqualsEqualsEqualsToken);
            }
            else {
                const ret = prepareQJSTempVar(QJSCType.Bool, QJSJSType.Bool);
                writeQJSKeyword(qjsTypeInfo[ret.type].type);
                writeQJSSpace();
                writeQJSBase(ret.name);
                writeQJSSpace();
                writeQJSPunctuation("=");
                writeQJSSpace();

                writeQJSBase(generateQJSJSStrictEQ(qjsLeft, qjsRight));
                writeQJSTrailingSemicolon();
                writeQJSLine();
            }
        }

        function emitQJSDeclareQJSVar(qjsVar: QJSVar) {
            writeQJSKeyword(qjsTypeInfo[qjsVar.type].type);
            writeQJSSpace();
            writeQJSKeyword(qjsVar.name);
            writeQJSTrailingSemicolon();
            writeQJSLine();
        }

        function emitQJSInitGlobalVar(qjsVar: QJSVar) {
            let atom = qjsAtomMap.get(qjsVar.jsvar!.name)!;
            if (!atom) {
                const jsName = qjsVar.jsvar!.name;
                const varAtomName = qjsTypeInfo[QJSCType.JSAtom].prefix + jsName;
                const qjsAtomVar = qjsNewVar(undefined, QJSCType.JSAtom, varAtomName, true, true);
                qjsAtomMap.set(jsName, qjsAtomVar);
                atom = qjsAtomVar;
            }

            //writeQJSKeyword(qjsTypeInfo[QJSCType.JSValue].type);
            //writeQJSSpace();
            writeQJSKeyword(qjsVar.name);
            writeQJSSpace();
            writeQJSPunctuation("=");
            writeQJSSpace();
            writeQJSBase(generateQJSGetGlobalVar(atom));
            writeQJSTrailingSemicolon();
            writeQJSLine();

            qjsVar.jsvar!.inited = true;
            qjsVar.needfree = true;
        }

        function emitQJSInitProp(qjsVar: QJSVar) {
            emitQJSGetProperty(qjsVar);
        }

        function emitQJSBinaryExpressionEqualsTo(node: BinaryExpression) {
            const qjsRight = popQJSValueStack();

            if (qjsRight.jsvar && !qjsRight.jsvar.inited) {
                if (qjsRight.jsvar.kind === QJSJSVarKind.GlobalVar) {
                    emitQJSInitGlobalVar(qjsRight);
                }
                else if (qjsRight.jsvar.kind === QJSJSVarKind.Prop) {
                    emitQJSGetProperty(qjsRight);
                }
            }

            if (node.left.kind === SyntaxKind.ElementAccessExpression) {
                const index = popQJSValueStack();
                const array = popQJSValueStack();

                const tempVar = emitQJSBoxVal(qjsRight);

                if ((index.type === QJSCType.IntLiteral ||
                    index.type === QJSCType.Int) &&
                    index.value) {
                    writeQJSBase(generateQJSSetPropertyInt(array, index, tempVar));
                    tempVar.needfree = false;
                }
                else {
                    writeQJSBase(generateQJSSetPropertyInt64(array, index, tempVar));
                    tempVar.needfree = false;
                }
                writeQJSTrailingSemicolon();
                writeQJSLine();
            }
            else {
                const qjsLeft = popQJSValueStack();

                qjsUpdateFrame(qjsLeft.jsvar!);

                if (qjsLeft.jsvar && !qjsLeft.jsvar.inited &&
                    (qjsLeft.jsvar.kind === QJSJSVarKind.GlobalVar ||
                    qjsLeft.jsvar.kind === QJSJSVarKind.Prop)) {
                    qjsLeft.jsvar.inited = true;
                }

                qjsLeft.jsvar!.needsync = true;

                switch (qjsRight.type) {
                    case QJSCType.JSValue:
                        writeQJSBase(generateQJSSetValue(qjsLeft, qjsRight));
                        writeQJSTrailingSemicolon();
                        writeQJSLine(2);
                        break;
                    case QJSCType.IntLiteral:
                    case QJSCType.FloatLiteral:
                    case QJSCType.Int:
                    case QJSCType.Double:
                        if (qjsLeft.type === qjsRight.type) {
                            qjsLeft.value = qjsRight.value;
                            qjsLeft.jstype = qjsRight.jstype;
                            if (qjsLeft.jsvar) {
                                qjsLeft.jsvar.value = qjsLeft.value;
                                qjsLeft.jsvar.type = qjsRight.jstype;
                                qjsLeft.jsvar.needsync = true;
                            }
                            writeQJSKeyword(qjsLeft.name);
                            writeQJSSpace();
                            writeQJSPunctuation("=");
                            writeQJSSpace();
                            writeQJSKeyword(qjsRight.name);
                            writeQJSTrailingSemicolon();
                            writeQJSLine(2);
                            break;
                        }

                        if (qjsLeft.type === QJSCType.Int || qjsLeft.type === QJSCType.Double) {
                            const type = qjsLeft.type === QJSCType.Int ? QJSCType.Double : QJSCType.Int;
                            const tempVar = prepareQJSTempVar(type, qjsRight.jstype);
                            tempVar.value = qjsRight.value;
                            writeQJSKeyword(qjsTypeInfo[tempVar.type].type);
                            writeQJSSpace();
                            writeQJSKeyword(tempVar.name);
                            writeQJSSpace();
                            writeQJSPunctuation("=");
                            writeQJSSpace();
                            writeQJSKeyword(qjsRight.name);
                            writeQJSTrailingSemicolon();
                            writeQJSLine();

                            if (qjsLeft.jsvar) {
                                qjsLeft.jsvar.cvar = tempVar;
                                qjsLeft.jsvar.type = tempVar.jstype;
                                tempVar.jsvar = qjsLeft.jsvar;
                                qjsLeft.jsvar = undefined;
                                tempVar.jsvar.value = tempVar.value;
                            }
                        }
                        else if (qjsLeft.type === QJSCType.JSValue) {
                            qjsLeft.value = qjsRight.value;
                            qjsLeft.jstype = qjsRight.jstype;
                            if (qjsLeft.jsvar) {
                                qjsLeft.jsvar.value = qjsLeft.value;
                                qjsLeft.jsvar.type = qjsLeft.jstype;
                                qjsLeft.jsvar.needsync = true;
                            }

                            writeQJSBase(generateQJSSetTempValue(qjsLeft, qjsRight));
                            writeQJSTrailingSemicolon();
                            writeQJSLine(2);
                        }
                        break;
                    default:
                        Debug.fail("qjs emitter: unsupportd type in emitQJSBinaryExpressionEqualsTo");
                        break;
                }
            }

        }

        function emitQJSBoxVal(val: QJSVar): QJSVar {
            if (val.type === QJSCType.JSValue) {
                return val;
            }

            const tempVar = prepareQJSTempVar(QJSCType.JSValue, val.jstype);
            popQJSValueStack();
            if (val.type === QJSCType.Int ||
                val.type === QJSCType.Double) {
                writeQJSKeyword(qjsTypeInfo[QJSCType.JSValue].type);
                writeQJSSpace();
                writeQJSKeyword(tempVar.name);
                writeQJSSpace();
                writeQJSPunctuation("=");
                writeQJSSpace();
                writeQJSBase(generateQJSMKVal(val));
                writeQJSTrailingSemicolon();
                writeQJSLine();
            }

            return tempVar;
        }


        function emitQJSUnboxVal(val: QJSVar | undefined, ret: QJSVar) {
            if (!val || ret.type === QJSCType.JSValue) {
                return;
            }

            let unboxCode = "";
            if (ret.type === QJSCType.Int) {
                unboxCode = generateQJSJSValueGetInt(val)
            }
            else if (ret.type === QJSCType.Double) {
                unboxCode = generateQJSJSValueGetFloat64(val);
            }

            writeQJSKeyword(ret.name);
            writeQJSSpace();
            writeQJSPunctuation("=");
            writeQJSSpace();
            writeQJSBase(unboxCode);
            writeQJSTrailingSemicolon();
            writeQJSLine();
        }

        function emitQJSGetElement(array: QJSVar, index: QJSVar, val: QJSVar) {
            let tempVar: QJSVar | undefined;
            if (val.type === QJSCType.JSValue) {
                writeQJSKeyword(val.name);
            }
            else {
                tempVar = prepareQJSTempVar(QJSCType.JSValue, val.jstype);
                popQJSValueStack();
                writeQJSKeyword(qjsTypeInfo[QJSCType.JSValue].type);
                writeQJSSpace();
                writeQJSBase(tempVar.name);
            }

            writeQJSSpace();
            writeQJSPunctuation("=");
            writeQJSSpace();
            if (index.jstype === QJSJSType.NumLiteral) {
                if (index.type === QJSCType.Int) {
                    writeQJSBase(generateQJSGetElementValue(array, index));
                }
                else {
                    writeQJSBase(generateQJSGetPropertyValue(array, index));
                }
            }
            else if (index.jstype === QJSJSType.Int32) {
                //let indexCode = index.name;
                //if (index.type === QJSCType.JSValue) {
                //    indexCode = generateQJSJSValueGetInt(index);
                //}
                writeQJSBase(generateQJSGetElementValue(array, index));
            }
            else if (index.jstype === QJSJSType.Float64) {
                writeQJSBase(generateQJSGetPropertyValue(array, index));
            }
            else if (index.jstype === QJSJSType.String) {
                writeQJSBase(generateQJSGetPropertyValue(array, index));
            }
            writeQJSTrailingSemicolon();
            writeQJSLine();

            emitQJSUnboxVal(tempVar, val);

        }

        function emitQJSGetProperty(qjsVar: QJSVar): QJSVar {
            const [obj, name] = qjsVar.jsvar!.name.split("|");
            const atom = qjsAtomMap.get(name)!;
            let tempVar: QJSVar | undefined;

            if (qjsVar.type === QJSCType.JSValue) {
                writeQJSKeyword(qjsVar.name);
            }
            else {
                tempVar = prepareQJSTempVar(QJSCType.JSValue, qjsVar.jstype);
                popQJSValueStack();
                writeQJSKeyword(qjsTypeInfo[QJSCType.JSValue].type);
                writeQJSSpace();
                writeQJSBase(tempVar.name);
            }
            writeQJSSpace();
            writeQJSPunctuation("=");
            writeQJSSpace();
            writeQJSBase(generateQJSGetProperty(obj, atom.name));
            writeQJSTrailingSemicolon();
            writeQJSLine();

            emitQJSUnboxVal(tempVar, qjsVar);

            qjsVar.jsvar!.inited = true;
            qjsVar.value = undefined;

            return qjsVar;
        }

        function emitQJSSetProperty(obj: QJSVar | string, prop: QJSVar, val: QJSVar) {
            if (val.type === QJSCType.JSValue) {
                writeQJSBase(generateQJSSetProperty(obj, prop.name, val));
            }
            else {
                writeQJSBase(generateQJSSetProperty(obj, prop.name, generateQJSMKVal(val)));
            }
            writeQJSTrailingSemicolon();
            writeQJSLine();

            if (prop.jsvar) {
                prop.jsvar.cvar = val;
                prop.jsvar.type = val.jstype;
                prop.jsvar.needsync = false;
                val.jsvar = prop.jsvar;
                prop.jsvar = undefined;
            }
        }
/*
        function emitQJSGetGlobalVar(qjsVar: QJSVar): QJSVar {
            prepareQJSTempVar(QJSCType.JSValue, qjsVar.jsvar!.type);
            const leftVar = popQJSValueStack();
            writeQJSKeyword(qjsTypeInfo[QJSCType.JSValue].type);
            writeQJSSpace();
            writeQJSKeyword(leftVar.name);
            writeQJSSpace();
            writeQJSPunctuation("=");
            writeQJSSpace();
            writeQJSBase(generateQJSGetGlobalVar(qjsVar));
            writeQJSTrailingSemicolon();
            writeQJSLine();

            if (qjsVar.jsvar) {
                qjsUpdateVarMap(qjsVar.jsvar.name, leftVar);
                qjsVar.jsvar = undefined;
            }
            qjsVar.needfree = true;
            return leftVar;
        }
*/
        function emitQJSSetGlobalVar(atom: QJSVar, val: QJSVar, flags = "2") {
            if (val.type === QJSCType.JSValue) {
                writeQJSBase(generateQJSSetGlobalVar(atom, val, flags));
            }
            else {
                writeQJSBase(generateQJSSetGlobalVar(atom, generateQJSMKVal(val), flags));
            }
            writeQJSTrailingSemicolon();
            writeQJSLine();

            Debug.assert(val.jsvar && val.jsvar.cvar === val);

            if (val.jsvar) {
                val.jsvar.needsync = false;
            }

            val.needfree = false;
        }

        function emitQJSTryConstFolding(node: BinaryExpression, qjsLeft: QJSVar, qjsRight: QJSVar): QJSVar | undefined {
            if (!qjsConfig.enableConstantFolding) {
                return undefined;
            }

            function calculate(opnd1: number, opnd2: number, op: BinaryOperatorToken): number {
                let ret: number;
                switch (op.kind) {
                    case SyntaxKind.PlusToken:
                        ret = opnd1 + opnd2;
                        break;
                    case SyntaxKind.MinusToken:
                        ret = opnd1 - opnd2;
                        break;
                    case SyntaxKind.AsteriskToken:
                        ret = opnd1 * opnd2;
                        break;
                    case SyntaxKind.SlashToken:
                        ret = opnd1 / opnd2;
                        break;
                    default:
                        Debug.fail("qjs emitter: unreachable");
                        break;
                }

                return ret;
            }

            let retVal: QJSVar | undefined;
            if (((qjsLeft.jstype === QJSJSType.NumLiteral ||
                qjsLeft.jsvar && qjsLeft.jsvar.type === QJSJSType.NumLiteral) && (
                qjsRight.jstype === QJSJSType.NumLiteral ||
                qjsRight.jsvar && qjsRight.jsvar.type === QJSJSType.NumLiteral))) {
                    let constRet: number;
                    if (qjsLeft.value) {
                        constRet = +qjsLeft.value;
                    }
                    else {
                        constRet = +qjsLeft.jsvar!.value!;
                    }

                    if (qjsRight.value) {
                        constRet = calculate(constRet, +qjsRight.value, node.operatorToken);
                    }
                    else {
                        constRet = calculate(constRet, +qjsRight.jsvar!.value!, node.operatorToken);
                    }

                    retVal = prepareQJSTempVar(Number.isInteger(constRet) ? QJSCType.Int : QJSCType.Double,
                                            QJSJSType.NumLiteral);

                    retVal.value = constRet.toString();
                    retVal.needfree = false;
            }
            else {
                if (node.operatorToken.kind !== SyntaxKind.PlusToken) {
                    return undefined;
                }

                if ((qjsLeft.jstype === QJSJSType.StringLiteral ||
                    qjsLeft.jsvar && qjsLeft.jsvar.type === QJSJSType.StringLiteral) && (
                    qjsRight.jstype === QJSJSType.StringLiteral ||
                    qjsRight.jsvar && qjsRight.jsvar.type === QJSJSType.StringLiteral)) {
                        let constRet = "";
                        if (qjsLeft.value) {
                            constRet = qjsLeft.value;
                        }
                        else {
                            constRet = qjsLeft.jsvar!.value!;
                        }

                        if (qjsRight.value) {
                            constRet += qjsRight.value;
                        }
                        else {
                            constRet += qjsRight.jsvar!.value!;
                        }

                        retVal = prepareQJSTempVar(QJSCType.JSValue, QJSJSType.StringLiteral);
                        retVal.value = constRet;
                        retVal.needfree = true;
                }
            }

            if (retVal) {
                writeQJSKeyword(qjsTypeInfo[retVal.type].type);
                writeQJSSpace();
                writeQJSKeyword(retVal.name);
                writeQJSSpace();
                writeQJSPunctuation("=");
                writeQJSSpace();
                if (retVal.jstype === QJSJSType.NumLiteral) {
                    writeQJSBase(retVal.value!);
                }
                else if (retVal.jstype === QJSJSType.StringLiteral) {
                    writeQJSBase(generateQJSNewString("\"" + retVal.value + "\""));
                }

                writeQJSTrailingSemicolon();
                writeQJSLine();

                return retVal;
            }

            return undefined;
        }

        function handleQJSIntFunc(qjsLeft: QJSVar, qjsRight: QJSVar, funcGen: (func: string, left: string, right: string) => string,
            funcIntInt: string, funcIntNum: string): {emitFunc: string, jsType: QJSJSType, needfree: boolean} {
            let emitFunc: string;
            let jsType: QJSJSType;
            let needfree = false;
            switch (qjsRight.type) {
                case QJSCType.Int:
                    emitFunc = funcGen(funcIntInt, qjsLeft.name, qjsRight.name);
                    jsType = QJSJSType.Int32;
                    needfree = false;
                    break;
                case QJSCType.Double:
                    emitFunc = funcGen(funcIntNum, qjsLeft.name, qjsRight.name);
                    jsType = QJSJSType.Float64;
                    needfree = false;
                    break;
                case QJSCType.JSValue:
                    emitFunc = funcGen(funcIntNum, qjsLeft.name, qjsRight.name);
                    jsType = QJSJSType.Float64;
                    needfree = false;
                    break;
                default:
                    Debug.fail("qjs emitter: unsupported type now");
                    break;
            }

            return {emitFunc, jsType, needfree};
        }

        function handleQJSDoubleFunc(qjsLeft: QJSVar, qjsRight: QJSVar, funcGen: (func: string, left: string, right: string) => string,
            funcNumInt: string, funcNumNum: string): {emitFunc: string, jsType: QJSJSType, needfree: boolean}  {
            let emitFunc: string;
            let jsType: QJSJSType;
            let needfree = false;
            switch (qjsRight.type) {
                case QJSCType.Int:
                    emitFunc = funcGen(funcNumInt, qjsLeft.name, qjsRight.name);
                    jsType = QJSJSType.Float64;
                    needfree = false;
                    break;
                case QJSCType.Double:
                    emitFunc = funcGen(funcNumNum, qjsLeft.name, qjsRight.name);
                    jsType = QJSJSType.Float64;
                    needfree = false;
                    break;
                case QJSCType.JSValue:
                    emitFunc = funcGen(funcNumNum, qjsLeft.name, qjsRight.name);
                    jsType = QJSJSType.Float64;
                    needfree = false;
                    break;
                default:
                    Debug.fail("qjs emitter: unsupported type now");
                    break;
            }
            return {emitFunc, jsType, needfree};
        }

        function handleQJS2JSValueFunc(qjsLeft: QJSVar, qjsRight: QJSVar, funcGen: (func: string, left: string, right: string) => string,
            funcNumNum: string): {emitFunc: string, jsType: QJSJSType, needfree: boolean} {
            let emitFunc: string;
            let jsType: QJSJSType;
            let needfree = false;
            const isLeftNum = (qjsLeft.jstype === QJSJSType.Int32 ||
                qjsLeft.jstype === QJSJSType.Float64 ||
                qjsLeft.jstype === QJSJSType.NumLiteral);
            const isRightNum = (qjsRight.jstype === QJSJSType.Int32 ||
                qjsRight.jstype === QJSJSType.Float64 ||
                qjsRight.jstype === QJSJSType.NumLiteral);
            const isLeftStr = (qjsLeft.jstype === QJSJSType.String ||
                qjsLeft.jstype === QJSJSType.StringLiteral);
            const isRightStr = (qjsRight.jstype === QJSJSType.String ||
                qjsRight.jstype === QJSJSType.StringLiteral);

            Debug.assert(isLeftNum || isLeftStr, "qjs emitter: only num and str support add.");
            Debug.assert(isRightNum || isRightStr, "qjs emitter: only num and str support add.");

            if (isLeftNum) {
                if (isRightNum) {
                    emitFunc = funcGen(funcNumNum, qjsLeft.name, qjsRight.name);
                    jsType = QJSJSType.Float64;
                    needfree = false;
                }
                else {
                    Debug.fail("qjs emitter: unsupported operation.");
                }
            }
            else if (isLeftStr) {
                if (isRightStr) {
                    emitFunc = generateQJSConcatString(qjsLeft.name, qjsRight.name);
                    jsType = QJSJSType.String;
                    needfree = true;
                }
                else {
                    Debug.fail("qjs emitter: unsupported operation right now.");
                }
            }
            else {
                Debug.fail("qjs emitter: unsupported operation.");
            }

            return {emitFunc, jsType, needfree};
        }

        function handleQJSJSValueFunc(qjsLeft: QJSVar, qjsRight: QJSVar, funcGen: (func: string, left: string, right: string) => string,
            funcNumInt: string, funcNumNum: string): {emitFunc: string, jsType: QJSJSType, needfree: boolean} {
            let emitFunc: string;
            let jsType: QJSJSType;
            let needfree = false;
            switch (qjsRight.type) {
                case QJSCType.Int:
                    emitFunc = funcGen(funcNumInt, qjsLeft.name, qjsRight.name);
                    jsType = QJSJSType.Float64;
                    needfree = false;
                    break;
                case QJSCType.Double:
                    emitFunc = funcGen(funcNumNum, qjsLeft.name, qjsRight.name);
                    jsType = QJSJSType.Float64;
                    needfree = false;
                    break;
                case QJSCType.JSValue:
                    ({emitFunc, jsType, needfree} = handleQJS2JSValueFunc(qjsLeft, qjsRight, funcGen, funcNumNum));
                    break;
                default:
                    Debug.fail("qjs emitter: unsupported type now");
                    break;
            }

            return {emitFunc, jsType, needfree};
        }

        function generateQJSAddNumFunc(func: string, left: string, right: string): string {
            return func + "(ctx, " + left + ", " + right + ")";
        }

        function emitQJSBinaryExpressionPlus(node: BinaryExpression) {
            const qjsRight = popQJSValueStack();
            const qjsLeft = popQJSValueStack();

            let jsType = QJSJSType.Unknown;
            let emitFunc = "";
            let needfree = true;

            if (qjsLeft.jsvar &&
                !qjsLeft.jsvar.inited) {
                if (qjsLeft.jsvar.kind === QJSJSVarKind.GlobalVar) {
                    emitQJSInitGlobalVar(qjsLeft);
                }
                else if (qjsLeft.jsvar.kind === QJSJSVarKind.Prop) {
                    emitQJSGetProperty(qjsLeft);
                }
            }

            if (qjsRight.jsvar &&
                !qjsRight.jsvar.inited) {
                if (qjsRight.jsvar.kind === QJSJSVarKind.GlobalVar) {
                    emitQJSInitGlobalVar(qjsRight);
                }
                else if (qjsRight.jsvar.kind === QJSJSVarKind.Prop) {
                    emitQJSGetProperty(qjsRight);
                }
            }

            if (emitQJSTryConstFolding(node, qjsLeft, qjsRight)) {
                return;
            }

            switch (qjsLeft.type) {
                case QJSCType.Int:
                    ({emitFunc, jsType, needfree} = handleQJSIntFunc(qjsLeft, qjsRight, generateQJSAddNumFunc, QJSFunction.JS_AddIntInt, QJSFunction.JS_AddIntNumber));
                    break;
                case QJSCType.Double:
                    ({emitFunc, jsType, needfree} = handleQJSDoubleFunc(qjsLeft, qjsRight, generateQJSAddNumFunc, QJSFunction.JS_AddNumberInt, QJSFunction.JS_AddNumberNumber));
                    break;
                case QJSCType.JSValue:
                    ({emitFunc, jsType, needfree} = handleQJSJSValueFunc(qjsLeft, qjsRight, generateQJSAddNumFunc, QJSFunction.JS_AddNumberInt, QJSFunction.JS_AddNumberNumber));
                    break;
                default:
                    break;
            }

            const retVal = prepareQJSTempVar(QJSCType.JSValue, jsType);
            retVal.needfree = needfree;
            writeQJSKeyword(qjsTypeInfo[QJSCType.JSValue].type);
            writeQJSSpace();
            writeQJSKeyword(retVal.name);
            writeQJSSpace();
            writeQJSOperator("=");
            writeQJSSpace();
            writeQJSBase(emitFunc);
            writeQJSTrailingSemicolon();
            writeQJSLine();

        }

        function emitQJSBinaryExpressionPlusEqualsTo(node: BinaryExpression) {
            let qjsRight = popQJSValueStack();
            let qjsLeft: QJSVar;
            let jsType = QJSJSType.Unknown;
            let emitFunc = "";
            let needfree = true;

            if (qjsRight.jsvar && !qjsRight.jsvar.inited) {
                if (qjsRight.jsvar.kind === QJSJSVarKind.GlobalVar) {
                    emitQJSInitGlobalVar(qjsRight);
                }
                else if (qjsRight.jsvar.kind === QJSJSVarKind.Prop) {
                    emitQJSGetProperty(qjsRight);
                }
            }

            // get left value
            if (node.left.kind === SyntaxKind.ElementAccessExpression) {
                const index = popQJSValueStack();
                const array = popQJSValueStack();

                emitQJSElementAccessInternal(node.left as ElementAccessExpression, array, index);
                qjsLeft = popQJSValueStack();
                pushQJSValueStack(array);
                pushQJSValueStack(index);
            }
            else {
                qjsLeft = popQJSValueStack();
            }

            let retVal = emitQJSTryConstFolding(node, qjsLeft, qjsRight);
            if (!retVal) {
                switch (qjsLeft.type) {
                    case QJSCType.Int:
                        ({emitFunc, jsType, needfree} = handleQJSIntFunc(qjsLeft, qjsRight, generateQJSAddNumFunc, QJSFunction.JS_AddIntInt, QJSFunction.JS_AddIntNumber));
                        break;
                    case QJSCType.Double:
                        ({emitFunc, jsType, needfree} = handleQJSDoubleFunc(qjsLeft, qjsRight, generateQJSAddNumFunc, QJSFunction.JS_AddNumberInt, QJSFunction.JS_AddNumberNumber));
                        break;
                    case QJSCType.JSValue:
                        ({emitFunc, jsType, needfree} = handleQJSJSValueFunc(qjsLeft, qjsRight, generateQJSAddNumFunc, QJSFunction.JS_AddNumberInt, QJSFunction.JS_AddNumberNumber));
                        break;
                    default:
                        break;
                }

                retVal = prepareQJSTempVar(QJSCType.JSValue, jsType);
                retVal.needfree = needfree;

                writeQJSKeyword(qjsTypeInfo[QJSCType.JSValue].type);
                writeQJSSpace();
                writeQJSKeyword(retVal.name);
                writeQJSSpace();
                writeQJSOperator("=");
                writeQJSSpace();
                writeQJSBase(emitFunc);
                writeQJSTrailingSemicolon();
                writeQJSLine();
            }

            // set left value
            if (node.left.kind === SyntaxKind.ElementAccessExpression) {
                retVal = popQJSValueStack();
                const index = popQJSValueStack();
                const array = popQJSValueStack();
                //const tempVar = emitQJSBoxVal(retVal);

                if ((index.type === QJSCType.IntLiteral ||
                    index.type === QJSCType.Int) &&
                    index.value) {
                    writeQJSBase(generateQJSSetPropertyInt(array, index, retVal));
                    retVal.needfree = false;
                }
                else {
                    writeQJSBase(generateQJSSetPropertyInt64(array, index, retVal));
                    retVal.needfree = false;
                }
                writeQJSTrailingSemicolon();
                writeQJSLine();
            }
            else {
                qjsRight = popQJSValueStack();

                qjsUpdateFrame(qjsLeft.jsvar!);

                if (qjsLeft.jsvar && !qjsLeft.jsvar.inited &&
                    (qjsLeft.jsvar.kind === QJSJSVarKind.GlobalVar ||
                    qjsLeft.jsvar.kind === QJSJSVarKind.Prop)) {
                    qjsLeft.jsvar.inited = true;
                }

                qjsLeft.jsvar!.needsync = true;

                switch (qjsRight.type) {
                    case QJSCType.JSValue:
                        writeQJSBase(generateQJSSetValue(qjsLeft, qjsRight));
                        writeQJSTrailingSemicolon();
                        writeQJSLine(2);
                        break;
                    case QJSCType.IntLiteral:
                    case QJSCType.FloatLiteral:
                    case QJSCType.Int:
                    case QJSCType.Double:
                        if (qjsLeft.type === qjsRight.type) {
                            qjsLeft.value = qjsRight.value;
                            qjsLeft.jstype = qjsRight.jstype;
                            if (qjsLeft.jsvar) {
                                qjsLeft.jsvar.value = qjsLeft.value;
                                qjsLeft.jsvar.type = qjsRight.jstype;
                                qjsLeft.jsvar.needsync = true;
                            }
                            writeQJSKeyword(qjsLeft.name);
                            writeQJSSpace();
                            writeQJSPunctuation("=");
                            writeQJSSpace();
                            writeQJSKeyword(qjsRight.name);
                            writeQJSTrailingSemicolon();
                            writeQJSLine(2);
                            break;
                        }

                        if (qjsLeft.type === QJSCType.Int || qjsLeft.type === QJSCType.Double) {
                            const type = qjsLeft.type === QJSCType.Int ? QJSCType.Double : QJSCType.Int;
                            const tempVar = prepareQJSTempVar(type, qjsRight.jstype);
                            tempVar.value = qjsRight.value;
                            writeQJSKeyword(qjsTypeInfo[tempVar.type].type);
                            writeQJSSpace();
                            writeQJSKeyword(tempVar.name);
                            writeQJSSpace();
                            writeQJSPunctuation("=");
                            writeQJSSpace();
                            writeQJSKeyword(qjsRight.name);
                            writeQJSTrailingSemicolon();
                            writeQJSLine();

                            if (qjsLeft.jsvar) {
                                qjsLeft.jsvar.cvar = tempVar;
                                qjsLeft.jsvar.type = tempVar.jstype;
                                tempVar.jsvar = qjsLeft.jsvar;
                                qjsLeft.jsvar = undefined;
                                tempVar.jsvar.value = tempVar.value;
                            }
                        }
                        else if (qjsLeft.type === QJSCType.JSValue) {
                            qjsLeft.value = qjsRight.value;
                            qjsLeft.jstype = qjsRight.jstype;
                            if (qjsLeft.jsvar) {
                                qjsLeft.jsvar.value = qjsLeft.value;
                                qjsLeft.jsvar.type = qjsLeft.jstype;
                                qjsLeft.jsvar.needsync = true;
                            }

                            writeQJSBase(generateQJSSetTempValue(qjsLeft, qjsRight));
                            writeQJSTrailingSemicolon();
                            writeQJSLine(2);
                        }
                        break;
                    default:
                        Debug.fail("qjs emitter: unsupportd type in emitQJSBinaryExpressionEqualsTo");
                        break;
                }
            }
        }

        function emitQJSBinaryExpressionMinus(node: BinaryExpression) {
            const qjsRight = popQJSValueStack();
            const qjsLeft = popQJSValueStack();

            let jsType = QJSJSType.Unknown;
            let emitFunc = "";
            let needfree = true;

            function generateQJSSubNumFunc(func: string, left: string, right: string) {
                return func + "(ctx, " + left + ", " + right + ")";
            }

            if (qjsLeft.jsvar &&
                qjsLeft.jsvar.kind === QJSJSVarKind.GlobalVar &&
                !qjsLeft.jsvar.inited) {
                emitQJSInitGlobalVar(qjsLeft);
            }

            if (qjsRight.jsvar &&
                qjsRight.jsvar.kind === QJSJSVarKind.GlobalVar &&
                !qjsRight.jsvar.inited) {
                emitQJSInitGlobalVar(qjsRight);
            }

            if (emitQJSTryConstFolding(node, qjsLeft, qjsRight)) {
                return;
            }

            switch (qjsLeft.type) {
                case QJSCType.Int:
                    ({emitFunc, jsType, needfree} = handleQJSIntFunc(qjsLeft, qjsRight, generateQJSSubNumFunc, QJSFunction.JS_SubIntInt, QJSFunction.JS_SubIntNumber));
                    break;
                case QJSCType.Double:
                    ({emitFunc, jsType, needfree} = handleQJSDoubleFunc(qjsLeft, qjsRight, generateQJSSubNumFunc, QJSFunction.JS_SubNumberInt, QJSFunction.JS_SubNumberNumber));
                    break;
                case QJSCType.JSValue:
                    ({emitFunc, jsType, needfree} = handleQJSJSValueFunc(qjsLeft, qjsRight, generateQJSSubNumFunc, QJSFunction.JS_SubNumberInt, QJSFunction.JS_SubNumberNumber));
                    break;
                default:
                    break;
            }

            const retVal = prepareQJSTempVar(QJSCType.JSValue, jsType);
            retVal.needfree = needfree;
            writeQJSKeyword(qjsTypeInfo[QJSCType.JSValue].type);
            writeQJSSpace();
            writeQJSKeyword(retVal.name);
            writeQJSSpace();
            writeQJSOperator("=");
            writeQJSSpace();
            writeQJSBase(emitFunc);
            writeQJSTrailingSemicolon();
            writeQJSLine();
        }

        function emitQJSBinaryExpressionAsterisk(node: BinaryExpression) {
            const qjsRight = popQJSValueStack();
            const qjsLeft = popQJSValueStack();

            let jsType = QJSJSType.Unknown;
            let emitFunc = "";
            let needfree = true;

            function generateQJSMulNumFunc(func: string, left: string, right: string) {
                return func + "(ctx, " + left + ", " + right + ")";
            }

            if (qjsLeft.jsvar &&
                qjsLeft.jsvar.kind === QJSJSVarKind.GlobalVar &&
                !qjsLeft.jsvar.inited) {
                emitQJSInitGlobalVar(qjsLeft);
            }

            if (qjsRight.jsvar &&
                qjsRight.jsvar.kind === QJSJSVarKind.GlobalVar &&
                !qjsRight.jsvar.inited) {
                emitQJSInitGlobalVar(qjsRight);
            }

            if (emitQJSTryConstFolding(node, qjsLeft, qjsRight)) {
                return;
            }

            switch (qjsLeft.type) {
                case QJSCType.Int:
                    ({emitFunc, jsType, needfree} = handleQJSIntFunc(qjsLeft, qjsRight, generateQJSMulNumFunc, QJSFunction.JS_MulIntInt, QJSFunction.JS_MulIntNumber));
                    break;
                case QJSCType.Double:
                    ({emitFunc, jsType, needfree} = handleQJSDoubleFunc(qjsLeft, qjsRight, generateQJSMulNumFunc, QJSFunction.JS_MulNumberInt, QJSFunction.JS_MulNumberNumber));
                    break;
                case QJSCType.JSValue:
                    ({emitFunc, jsType, needfree} = handleQJSJSValueFunc(qjsLeft, qjsRight, generateQJSMulNumFunc, QJSFunction.JS_MulNumberInt, QJSFunction.JS_MulNumberNumber));
                    break;
                default:
                    break;
            }

            const retVal = prepareQJSTempVar(QJSCType.JSValue, jsType);
            retVal.needfree = needfree;
            writeQJSKeyword(qjsTypeInfo[QJSCType.JSValue].type);
            writeQJSSpace();
            writeQJSKeyword(retVal.name);
            writeQJSSpace();
            writeQJSOperator("=");
            writeQJSSpace();
            writeQJSBase(emitFunc);
            writeQJSTrailingSemicolon();
            writeQJSLine();

        }

        function emitQJSBinaryExpressionSlash(node: BinaryExpression) {
            const qjsRight = popQJSValueStack();
            const qjsLeft = popQJSValueStack();

            let jsType = QJSJSType.Unknown;
            let emitFunc = "";
            let needfree = true;

            function generateQJSDivNumFunc(func: string, left: string, right: string) {
                return func + "(ctx, " + left + ", " + right + ")";
            }

            if (qjsLeft.jsvar &&
                qjsLeft.jsvar.kind === QJSJSVarKind.GlobalVar &&
                !qjsLeft.jsvar.inited) {
                emitQJSInitGlobalVar(qjsLeft);
            }

            if (qjsRight.jsvar &&
                qjsRight.jsvar.kind === QJSJSVarKind.GlobalVar &&
                !qjsRight.jsvar.inited) {
                emitQJSInitGlobalVar(qjsRight);
            }

            if (emitQJSTryConstFolding(node, qjsLeft, qjsRight)) {
                return;
            }

            switch (qjsLeft.type) {
                case QJSCType.Int:
                    ({emitFunc, jsType, needfree} = handleQJSIntFunc(qjsLeft, qjsRight, generateQJSDivNumFunc, QJSFunction.JS_DivIntInt, QJSFunction.JS_DivIntNumber));
                    break;
                case QJSCType.Double:
                    ({emitFunc, jsType, needfree} = handleQJSDoubleFunc(qjsLeft, qjsRight, generateQJSDivNumFunc, QJSFunction.JS_DivNumberInt, QJSFunction.JS_DivNumberNumber));
                    break;
                case QJSCType.JSValue:
                    ({emitFunc, jsType, needfree} = handleQJSJSValueFunc(qjsLeft, qjsRight, generateQJSDivNumFunc, QJSFunction.JS_DivNumberInt, QJSFunction.JS_DivNumberNumber));
                    break;
                default:
                    break;
            }

            const retVal = prepareQJSTempVar(QJSCType.JSValue, jsType);
            retVal.needfree = needfree;
            writeQJSKeyword(qjsTypeInfo[QJSCType.JSValue].type);
            writeQJSSpace();
            writeQJSKeyword(retVal.name);
            writeQJSSpace();
            writeQJSOperator("=");
            writeQJSSpace();
            writeQJSBase(emitFunc);
            writeQJSTrailingSemicolon();
            writeQJSLine();
        }

        function emitQJSBinaryExpression(node: BinaryExpression) {
            if (!printerOptions.emitQJSCode) {
                return;
            }

            if (node.operatorToken) {
                switch (node.operatorToken.kind) {
                    case SyntaxKind.LessThanEqualsToken:
                        case SyntaxKind.LessThanToken:
                        emitQJSBinaryExpressionCompNum(node.operatorToken.kind);
                        break;
                    case SyntaxKind.EqualsEqualsEqualsToken:
                        emitQJSBinaryExpressionStrictEquals();
                        break;
                    case SyntaxKind.EqualsToken:
                        emitQJSBinaryExpressionEqualsTo(node);
                        break;
                    case SyntaxKind.PlusToken:
                        emitQJSBinaryExpressionPlus(node);
                        break;
                    case SyntaxKind.PlusEqualsToken:
                        emitQJSBinaryExpressionPlusEqualsTo(node);
                        break;
                    case SyntaxKind.MinusToken:
                        emitQJSBinaryExpressionMinus(node);
                        break;
                    case SyntaxKind.AsteriskToken:
                        emitQJSBinaryExpressionAsterisk(node);
                        break;
                    case SyntaxKind.SlashToken:
                        emitQJSBinaryExpressionSlash(node);
                        break;
                    case SyntaxKind.AmpersandAmpersandToken:
                        emitQJSBinaryExpressionLogic(node.operatorToken.kind);
                        break;
                    default:
                        Debug.log(`QJS emitter: unsupported binary expression operator ${node.operatorToken.kind}.`);
                        break;

                }
            }
        }

        function createEmitBinaryExpression() {
            interface WorkArea {
                stackIndex: number;
                preserveSourceNewlinesStack: (boolean | undefined)[];
                containerPosStack: number[];
                containerEndStack: number[];
                declarationListContainerEndStack: number[];
                shouldEmitCommentsStack: boolean[];
                shouldEmitSourceMapsStack: boolean[];
            }

            return createBinaryExpressionTrampoline(onEnter, onLeft, onOperator, onRight, onExit, /*foldState*/ undefined);

            function onEnter(node: BinaryExpression, state: WorkArea | undefined) {
                if (state) {
                    state.stackIndex++;
                    state.preserveSourceNewlinesStack[state.stackIndex] = preserveSourceNewlines;
                    state.containerPosStack[state.stackIndex] = containerPos;
                    state.containerEndStack[state.stackIndex] = containerEnd;
                    state.declarationListContainerEndStack[state.stackIndex] = declarationListContainerEnd;
                    const emitComments = state.shouldEmitCommentsStack[state.stackIndex] = shouldEmitComments(node);
                    const emitSourceMaps = state.shouldEmitSourceMapsStack[state.stackIndex] = shouldEmitSourceMaps(node);
                    onBeforeEmitNode?.(node);
                    if (emitComments) emitCommentsBeforeNode(node);
                    if (emitSourceMaps) emitSourceMapsBeforeNode(node);
                    beforeEmitNode(node);
                }
                else {
                    state = {
                        stackIndex: 0,
                        preserveSourceNewlinesStack: [undefined],
                        containerPosStack: [-1],
                        containerEndStack: [-1],
                        declarationListContainerEndStack: [-1],
                        shouldEmitCommentsStack: [false],
                        shouldEmitSourceMapsStack: [false],
                    };
                }
                return state;
            }

            function onLeft(next: Expression, _workArea: WorkArea, parent: BinaryExpression) {
                if (isAssignmentExpression(parent, false)) {
                    qjsEmitterState = QJSValueStackState.LValue;
                }
                else {
                    qjsEmitterState = QJSValueStackState.RValue;
                }
                const expr = maybeEmitExpression(next, parent, "left");
                qjsEmitterState = QJSValueStackState.None;
                if (expr) {
                    qjsEmitterState = QJSValueStackState.RValue;
                }
                return expr;
            }

            function onOperator(operatorToken: BinaryOperatorToken, _state: WorkArea, node: BinaryExpression) {
                const isCommaOperator = operatorToken.kind !== SyntaxKind.CommaToken;
                const linesBeforeOperator = getLinesBetweenNodes(node, node.left, operatorToken);
                const linesAfterOperator = getLinesBetweenNodes(node, operatorToken, node.right);
                writeLinesAndIndent(linesBeforeOperator, isCommaOperator);
                emitLeadingCommentsOfPosition(operatorToken.pos);
                writeTokenNode(operatorToken, operatorToken.kind === SyntaxKind.InKeyword ? writeKeyword : writeOperator);
                emitTrailingCommentsOfPosition(operatorToken.end, /*prefixSpace*/ true); // Binary operators should have a space before the comment starts
                writeLinesAndIndent(linesAfterOperator, /*writeSpaceIfNotIndenting*/ true);
            }

            function onRight(next: Expression, _workArea: WorkArea, parent: BinaryExpression) {
                qjsEmitterState = QJSValueStackState.RValue;
                const expr =  maybeEmitExpression(next, parent, "right");
                qjsEmitterState = QJSValueStackState.None;
                if (expr) {
                    qjsEmitterState = QJSValueStackState.RValue;
                }
                return expr;
            }

            function onExit(node: BinaryExpression, state: WorkArea) {
                const linesBeforeOperator = getLinesBetweenNodes(node, node.left, node.operatorToken);
                const linesAfterOperator = getLinesBetweenNodes(node, node.operatorToken, node.right);
                decreaseIndentIf(linesBeforeOperator, linesAfterOperator);
                if (state.stackIndex > 0) {
                    const savedPreserveSourceNewlines = state.preserveSourceNewlinesStack[state.stackIndex];
                    const savedContainerPos = state.containerPosStack[state.stackIndex];
                    const savedContainerEnd = state.containerEndStack[state.stackIndex];
                    const savedDeclarationListContainerEnd = state.declarationListContainerEndStack[state.stackIndex];
                    const shouldEmitComments = state.shouldEmitCommentsStack[state.stackIndex];
                    const shouldEmitSourceMaps = state.shouldEmitSourceMapsStack[state.stackIndex];
                    afterEmitNode(savedPreserveSourceNewlines);
                    if (shouldEmitSourceMaps) emitSourceMapsAfterNode(node);
                    if (shouldEmitComments) emitCommentsAfterNode(node, savedContainerPos, savedContainerEnd, savedDeclarationListContainerEnd);
                    onAfterEmitNode?.(node);
                    state.stackIndex--;
                }

                emitQJSBinaryExpression(node);
            }

            function maybeEmitExpression(next: Expression, parent: BinaryExpression, side: "left" | "right") {
                const parenthesizerRule = side === "left" ?
                    parenthesizer.getParenthesizeLeftSideOfBinaryForOperator(parent.operatorToken.kind) :
                    parenthesizer.getParenthesizeRightSideOfBinaryForOperator(parent.operatorToken.kind);

                let pipelinePhase = getPipelinePhase(PipelinePhase.Notification, EmitHint.Expression, next);
                if (pipelinePhase === pipelineEmitWithSubstitution) {
                    Debug.assertIsDefined(lastSubstitution);
                    next = parenthesizerRule(cast(lastSubstitution, isExpression));
                    pipelinePhase = getNextPipelinePhase(PipelinePhase.Substitution, EmitHint.Expression, next);
                    lastSubstitution = undefined;
                }

                if (pipelinePhase === pipelineEmitWithComments ||
                    pipelinePhase === pipelineEmitWithSourceMaps ||
                    pipelinePhase === pipelineEmitWithHint) {
                    if (isBinaryExpression(next)) {
                        return next;
                    }
                }

                currentParenthesizerRule = parenthesizerRule;
                pipelinePhase(EmitHint.Expression, next);
            }
        }

        function emitConditionalExpression(node: ConditionalExpression) {
            const linesBeforeQuestion = getLinesBetweenNodes(node, node.condition, node.questionToken);
            const linesAfterQuestion = getLinesBetweenNodes(node, node.questionToken, node.whenTrue);
            const linesBeforeColon = getLinesBetweenNodes(node, node.whenTrue, node.colonToken);
            const linesAfterColon = getLinesBetweenNodes(node, node.colonToken, node.whenFalse);

            emitExpression(node.condition, parenthesizer.parenthesizeConditionOfConditionalExpression);
            writeLinesAndIndent(linesBeforeQuestion, /*writeSpaceIfNotIndenting*/ true);
            emit(node.questionToken);
            writeLinesAndIndent(linesAfterQuestion, /*writeSpaceIfNotIndenting*/ true);
            emitExpression(node.whenTrue, parenthesizer.parenthesizeBranchOfConditionalExpression);
            decreaseIndentIf(linesBeforeQuestion, linesAfterQuestion);

            writeLinesAndIndent(linesBeforeColon, /*writeSpaceIfNotIndenting*/ true);
            emit(node.colonToken);
            writeLinesAndIndent(linesAfterColon, /*writeSpaceIfNotIndenting*/ true);
            emitExpression(node.whenFalse, parenthesizer.parenthesizeBranchOfConditionalExpression);
            decreaseIndentIf(linesBeforeColon, linesAfterColon);
        }

        function emitTemplateExpression(node: TemplateExpression) {
            emit(node.head);
            emitList(node, node.templateSpans, ListFormat.TemplateExpressionSpans);
        }

        function emitYieldExpression(node: YieldExpression) {
            emitTokenWithComment(SyntaxKind.YieldKeyword, node.pos, writeKeyword, node);
            emit(node.asteriskToken);
            emitExpressionWithLeadingSpace(node.expression && parenthesizeExpressionForNoAsi(node.expression), parenthesizeExpressionForNoAsiAndDisallowedComma);
        }

        function emitSpreadElement(node: SpreadElement) {
            emitTokenWithComment(SyntaxKind.DotDotDotToken, node.pos, writePunctuation, node);
            emitExpression(node.expression, parenthesizer.parenthesizeExpressionForDisallowedComma);
        }

        function emitClassExpression(node: ClassExpression) {
            generateNameIfNeeded(node.name);
            emitClassDeclarationOrExpression(node);
        }

        function emitExpressionWithTypeArguments(node: ExpressionWithTypeArguments) {
            emitExpression(node.expression, parenthesizer.parenthesizeLeftSideOfAccess);
            emitTypeArguments(node, node.typeArguments);
        }

        function emitAsExpression(node: AsExpression) {
            emitExpression(node.expression, /*parenthesizerRules*/ undefined);
            if (node.type) {
                writeSpace();
                writeKeyword("as");
                writeSpace();
                emit(node.type);
            }
        }

        function emitNonNullExpression(node: NonNullExpression) {
            emitExpression(node.expression, parenthesizer.parenthesizeLeftSideOfAccess);
            writeOperator("!");
        }

        function emitMetaProperty(node: MetaProperty) {
            writeToken(node.keywordToken, node.pos, writePunctuation);
            writePunctuation(".");
            emit(node.name);
        }

        //
        // Misc
        //

        function emitTemplateSpan(node: TemplateSpan) {
            emitExpression(node.expression);
            emit(node.literal);
        }

        //
        // Statements
        //

        function emitBlock(node: Block) {
            emitBlockStatements(node, /*forceSingleLine*/ !node.multiLine && isEmptyBlock(node));
        }

        function emitBlockStatements(node: BlockLike, forceSingleLine: boolean) {
            if (!!printerOptions.emitQJSCode) {
                emitQJSBlockBegin(node);
                const originNode = getParseTreeNode(node);
                emitQJSVarDefList(originNode);
            }

            emitTokenWithComment(SyntaxKind.OpenBraceToken, node.pos, writePunctuation, /*contextNode*/ node);
            const format = forceSingleLine || getEmitFlags(node) & EmitFlags.SingleLine ? ListFormat.SingleLineBlockStatements : ListFormat.MultiLineBlockStatements;
            emitList(node, node.statements, format);
            emitTokenWithComment(SyntaxKind.CloseBraceToken, node.statements.end, writePunctuation, /*contextNode*/ node, /*indentLeading*/ !!(format & ListFormat.MultiLine));

            if (!!printerOptions.emitQJSCode) {
                emitQJSBlockEnd();
                if (!(node.parent.kind === SyntaxKind.IfStatement &&
                    (node.parent as IfStatement).thenStatement === node &&
                    !!(node.parent as IfStatement).elseStatement)) {
                        writeQJSLine(2);
                }
            }
        }

        function emitVariableStatement(node: VariableStatement) {
            emitModifiers(node, node.modifiers);
            emit(node.declarationList);
            writeTrailingSemicolon();
        }

        function emitEmptyStatement(isEmbeddedStatement: boolean) {
            // While most trailing semicolons are possibly insignificant, an embedded "empty"
            // statement is significant and cannot be elided by a trailing-semicolon-omitting writer.
            if (isEmbeddedStatement) {
                writePunctuation(";");
            }
            else {
                writeTrailingSemicolon();
            }
        }

        function emitQJSExpressStatement() {
            if (!!printerOptions.emitQJSCode) {
                // sometimes a statement needs a result value
                //qjsValueStack.pop();
            }
        }

        function emitExpressionStatement(node: ExpressionStatement) {
            emitExpression(node.expression, parenthesizer.parenthesizeExpressionOfExpressionStatement);
            // Emit semicolon in non json files
            // or if json file that created synthesized expression(eg.define expression statement when --out and amd code generation)
            if (!isJsonSourceFile(currentSourceFile!) || nodeIsSynthesized(node.expression)) {
                writeTrailingSemicolon();
            }

            emitQJSExpressStatement();
        }

        function emitQJSIfStatement() {
            if (!printerOptions.emitQJSCode) {
                return;
            }

            const qjsVar = popQJSValueStack();

            writeQJSKeyword("if");
            writeQJSSpace();
            writeQJSPunctuation("(");
            writeQJSBase(qjsVar.name);
            writeQJSPunctuation(")");
            writeQJSSpace();
        }

        function mergeQJSPhiVars(vars: ESMap<string, QJSJSVar>) {
            vars.forEach((value, _) => {
                const outerJsVar = value.outer;
                let needUpdate = false;
                if (!outerJsVar) {
                    return;
                }

                if (outerJsVar.cvar !== value.cvar) {
                    return;
                }

                if (value.kind === QJSJSVarKind.GlobalVar) {
                    outerJsVar.needsync ||= value.needsync;
                }

                if (outerJsVar.type === QJSJSType.NumLiteral &&
                    value.type === QJSJSType.NumLiteral) {
                    if (outerJsVar.value === value.value) {
                        return;
                    }

                    if (Number.isInteger(+outerJsVar.value!) &&
                        Number.isInteger(+value.value!)) {
                            outerJsVar.type = QJSJSType.Int32;
                    }
                    else {
                        outerJsVar.type = QJSJSType.Float64;
                    }

                    outerJsVar.cvar.jstype = outerJsVar.type;
                    outerJsVar.value = undefined;
                    outerJsVar.cvar.value = undefined;

                    needUpdate = true;
                }
                else {
                    if (outerJsVar.type === QJSJSType.Int32 &&
                        value.type === QJSJSType.Int32) {
                        outerJsVar.type = QJSJSType.Int32;
                    }
                    else {
                        outerJsVar.type = QJSJSType.Float64;
                    }

                    outerJsVar.cvar.jstype = outerJsVar.type;
                    outerJsVar.value = undefined;
                    outerJsVar.cvar.value = undefined;

                    needUpdate = true;
                }

                if (!needUpdate) {
                    return;
                }

                qjsUpdateClosestPhiNode(outerJsVar);
            });
        }

        function qjsPhiAfterIf(phiNode: QJSIfPhiNode) {

            if (phiNode.thenVars.size > 0) {
                mergeQJSPhiVars(phiNode.thenVars);
            }

            if (phiNode.elseVars.size > 0) {
                mergeQJSPhiVars(phiNode.elseVars);
            }
        }

        function emitIfStatement(node: IfStatement) {
            const openParenPos = emitTokenWithComment(SyntaxKind.IfKeyword, node.pos, writeKeyword, node);
            writeSpace();
            emitTokenWithComment(SyntaxKind.OpenParenToken, openParenPos, writePunctuation, node);
            qjsEmitterState = QJSValueStackState.RValue;
            emitExpression(node.expression);
            qjsEmitterState = QJSValueStackState.None;

            let curFrame: QJSFrame;
            const saveBlockType = qjsCurBlockType;
            if (!!printerOptions.emitQJSCode) {
                if (!qjsConfig.enableLazyWriteBack) {
                    qjsWriteBackObjects();
                }

                emitQJSIfStatement();
                curFrame = qjsGetCurFrame();
                const ifphi: QJSIfPhiNode = {
                    kind: QJSPhiKind.IfPhi,
                    thenVars: new Map<string, QJSJSVar>(),
                    elseVars: new Map<string, QJSJSVar>(),
                    originVars: new Map<string, QJSJSVar>(),
                };
                curFrame.phinodes.push(ifphi);
                qjsCurBlockType = QJSBlockType.IfThen;
            }

            emitTokenWithComment(SyntaxKind.CloseParenToken, node.expression.end, writePunctuation, node);
            emitEmbeddedStatement(node, node.thenStatement);

            if (node.elseStatement) {
                qjsCurBlockType = QJSBlockType.IfElse;
                writeLineOrSpace(node, node.thenStatement, node.elseStatement);
                emitTokenWithComment(SyntaxKind.ElseKeyword, node.thenStatement.end, writeKeyword, node);

                if (!!printerOptions.emitQJSCode) {
                    writeQJSSpace();
                    writeQJSKeyword("else");
                    writeQJSSpace();
                }

                if (node.elseStatement.kind === SyntaxKind.IfStatement) {
                    writeSpace();
                    if (!!printerOptions.emitQJSCode) {
                        writeQJSPunctuation("{");
                        writeQJSLine();
                        increaseQJSIndent();
                    }
                    emit(node.elseStatement);

                    if (!!printerOptions.emitQJSCode) {
                        writeQJSLine();
                        decreaseQJSIndent();
                        writeQJSPunctuation("}");
                    }
                }
                else {
                    emitEmbeddedStatement(node, node.elseStatement);
                }
            }

            if (!!printerOptions.emitQJSCode) {
                qjsCurBlockType = saveBlockType;
                Debug.assert(curFrame!.phinodes.length > 0);
                const phinode = curFrame!.phinodes.pop()!;
                Debug.assert(phinode.kind === QJSPhiKind.IfPhi);
                qjsPhiAfterIf(phinode as QJSIfPhiNode);
            }
        }

        function emitWhileClause(node: WhileStatement | DoStatement, startPos: number) {
            const openParenPos = emitTokenWithComment(SyntaxKind.WhileKeyword, startPos, writeKeyword, node);
            writeSpace();
            emitTokenWithComment(SyntaxKind.OpenParenToken, openParenPos, writePunctuation, node);
            emitExpression(node.expression);
            emitTokenWithComment(SyntaxKind.CloseParenToken, node.expression.end, writePunctuation, node);
        }

        function emitDoStatement(node: DoStatement) {
            emitTokenWithComment(SyntaxKind.DoKeyword, node.pos, writeKeyword, node);
            emitEmbeddedStatement(node, node.statement);
            if (isBlock(node.statement) && !preserveSourceNewlines) {
                writeSpace();
            }
            else {
                writeLineOrSpace(node, node.statement, node.expression);
            }

            emitWhileClause(node, node.statement.end);
            writeTrailingSemicolon();
        }

        function emitWhileStatement(node: WhileStatement) {
            emitWhileClause(node, node.pos);
            emitEmbeddedStatement(node, node.statement);
        }

        function emitQJSForProlog(node: ForStatement) {
            (node);
            if (!printerOptions.emitQJSCode) {
                return;
            }

            const ret = prepareQJSTempVar(QJSCType.Bool, QJSJSType.Bool);
            popQJSValueStack();
            writeQJSKeyword(qjsTypeInfo[ret.type].type);
            writeQJSSpace();
            writeQJSKeyword(ret.name);
            writeQJSSpace();
            writeQJSPunctuation("=");
            writeQJSSpace();
            writeQJSKeyword(QJSReserved.True);
            writeQJSTrailingSemicolon();
            writeQJSLine();

            writeQJSKeyword(QJSReserved.While);
            writeQJSSpace();
            writeQJSPunctuation("(");
            writeQJSKeyword(ret.name);
            writeQJSPunctuation(")");
            writeQJSSpace();

            writeTokenText(SyntaxKind.OpenBraceToken, writeQJSPunctuation);
            writeQJSLine();
            increaseQJSIndent();

            const curFrame = qjsGetCurFrame();
            const forloopphi: QJSLoopPhiNode = {
                kind: QJSPhiKind.LoopPhi,
                loopVars: new Map<string, QJSJSVar>(),
            };
            curFrame.phinodes.push(forloopphi);
        }

        function emitQJSForBreak() {
            if (!printerOptions.emitQJSCode) {
                return;
            }
            const match = popQJSValueStack();
            writeQJSBase("if (!" + match.name + ") {");
            writeQJSLine();
            increaseQJSIndent();
            writeQJSKeyword(QJSReserved.Break);
            writeQJSTrailingSemicolon();
            writeQJSLine();

            decreaseQJSIndent();
            writeQJSBase("}");
            writeQJSLine();

        }

        function emitQJSForEpilog(node: ForStatement) {
            (node);
            if (!printerOptions.emitQJSCode) {
                return;
            }

            decreaseQJSIndent();
            writeTokenText(SyntaxKind.CloseBraceToken, writeQJSPunctuation);
            writeQJSLine();
        }

        function emitQJSCBlockBegin() {
            if (!printerOptions.emitQJSCode) {
                return;
            }
            writeQJSPunctuation("{");
            writeQJSLine();
            increaseQJSIndent();
        }

        function emitQJSCBlockEnd() {
            if (!printerOptions.emitQJSCode) {
                return;
            }
            decreaseQJSIndent();
            writeQJSPunctuation("}");
            writeQJSLine();
        }

        function emitForStatement(node: ForStatement) {
            if (!!printerOptions.emitQJSCode) {
                emitQJSCBlockBegin();
                emitQJSForLocalVarDef(node);
            }

            const openParenPos = emitTokenWithComment(SyntaxKind.ForKeyword, node.pos, writeKeyword, node);
            writeSpace();
            let pos = emitTokenWithComment(SyntaxKind.OpenParenToken, openParenPos, writePunctuation, /*contextNode*/ node);
            emitForBinding(node.initializer);

            if (!!printerOptions.emitQJSCode) {
                emitQJSForProlog(node);
            }
            const saveBlockType = qjsCurBlockType;
            qjsCurBlockType = QJSBlockType.Loop;

            pos = emitTokenWithComment(SyntaxKind.SemicolonToken, node.initializer ? node.initializer.end : pos, writePunctuation, node);
            emitExpressionWithLeadingSpace(node.condition);

            if (!!printerOptions.emitQJSCode) {
                emitQJSForBreak();
            }

            const saveCEmitterState = printerOptions.emitQJSCode;
            printerOptions.emitQJSCode = false;
            pos = emitTokenWithComment(SyntaxKind.SemicolonToken, node.condition ? node.condition.end : pos, writePunctuation, node);
            emitExpressionWithLeadingSpace(node.incrementor);
            printerOptions.emitQJSCode = saveCEmitterState;

            emitTokenWithComment(SyntaxKind.CloseParenToken, node.incrementor ? node.incrementor.end : pos, writePunctuation, node);
            emitEmbeddedStatement(node, node.statement);

            // inc needs to be put in the end of for loop in c code
            if (!!printerOptions.emitQJSCode) {
                const saveState = qjsEmitterState;
                qjsEmitterState = QJSValueStackState.None;
                pos = emitTokenWithComment(SyntaxKind.SemicolonToken, node.condition ? node.condition.end : pos, writePunctuation, node);
                const saveJSEmitState = qjsPauseJSEmit;
                qjsPauseJSEmit = true;
                emitExpressionWithLeadingSpace(node.incrementor);
                qjsPauseJSEmit = saveJSEmitState;
                qjsEmitterState = saveState;
            }

            if (!!printerOptions.emitQJSCode) {
                qjsCurBlockType = saveBlockType;

                const curFrame = qjsGetCurFrame();
                Debug.assert(curFrame.phinodes.length > 0);
                const phinode = curFrame.phinodes.pop()!;
                Debug.assert(phinode.kind === QJSPhiKind.LoopPhi);
                qjsPhiAfterLoop(phinode as QJSLoopPhiNode);

                emitQJSForEpilog(node);
                emitQJSCBlockEnd();
            }
        }

        function qjsPhiAfterLoop(phiNode: QJSLoopPhiNode) {
            if (phiNode.loopVars.size > 0) {
                mergeQJSPhiVars(phiNode.loopVars);
            }
        }

        function emitQJSForInProlog(node: Expression) {
            if (!printerOptions.emitQJSCode) {
                return;
            }

            const obj = popQJSValueStack();

            const iter = prepareQJSTempVar(QJSCType.JSValue, QJSJSType.Object);
            popQJSValueStack();
            writeQJSKeyword(qjsTypeInfo[iter.type].type);
            writeQJSSpace();
            writeQJSKeyword(iter.name);
            writeQJSTrailingSemicolon();
            writeQJSLine();

            writeQJSBase(generateQJSJSForInStart(obj, iter));
            writeQJSTrailingSemicolon();
            writeQJSLine();

            const ret = prepareQJSTempVar(QJSCType.Bool, QJSJSType.Bool);
            popQJSValueStack();
            writeQJSKeyword(qjsTypeInfo[ret.type].type);
            writeQJSSpace();
            writeQJSKeyword(ret.name);
            writeQJSSpace();
            writeQJSPunctuation("=");
            writeQJSSpace();
            writeQJSKeyword(QJSReserved.False);
            writeQJSTrailingSemicolon();
            writeQJSLine();

            writeQJSKeyword(QJSReserved.While);
            writeQJSSpace();
            writeQJSPunctuation("(");
            writeQJSPunctuation("!");
            writeQJSKeyword(ret.name);
            writeQJSPunctuation(")");
            writeQJSSpace();

            //const saveBlockType = qjsCurBlockType;
            //qjsCurBlockType = QJSBlockType.Loop;
            //emitQJSBlockBegin(node);

            writeTokenText(SyntaxKind.OpenBraceToken, writeQJSPunctuation);
            writeQJSLine();
            increaseQJSIndent();

            /*
            Debug.assert(!!node.parent.locals && node.parent.locals.size === 1);
            let keyName = "";
            node.parent.locals.forEach((_, key) => {
                keyName = key.toString();
            });
            const qjsJSVarMap = qjsGetCurFrame().jsvarmap;
            let keyJSVar = qjsJSVarMap.get(keyName);

            if (!keyJSVar) {
                keyJSVar = resolveQJSIdentifierInternal(keyName);
                if (keyJSVar) {
                    pushQJSValueStack(keyJSVar.cvar);
                }
            }
            */
            Debug.assert(!!node.parent.locals && node.parent.locals.size === 1);
            let keyName = "";
            node.parent.locals.forEach((_, key) => {
                keyName = key.toString();
            });
            const qjsJSVarMap = qjsGetCurFrame().jsvarmap;
            const keyJSVar = qjsJSVarMap.get(keyName)!;
            pushQJSValueStack(keyJSVar.cvar);
            const keyVar = popQJSValueStack();
            writeQJSBase(generateQJSJSForInNext(iter, keyVar, ret));
            writeQJSTrailingSemicolon();
            writeQJSLine();

            //qjsUpdateFrame(keyVar.jsvar!);
            //keyVar.jsvar!.needsync = true;

            writeQJSBase("if (" + ret.name + ") {");
            writeQJSLine();
            increaseQJSIndent();
            writeQJSKeyword(QJSReserved.Break);
            writeQJSTrailingSemicolon();
            writeQJSLine();

            decreaseQJSIndent();
            writeQJSBase("}");
            writeQJSLine();

            //qjsCurBlockType = saveBlockType;
        }

        function emitQJSForInEpilog(node: Expression) {
            if (!printerOptions.emitQJSCode) {
                return;
            }

            //emitQJSBlockEnd();
            Debug.assert(!!node.parent.locals && node.parent.locals.size === 1);
            let keyName = "";
            node.parent.locals.forEach((_, key) => {
                keyName = key.toString();
            });
            const qjsJSVarMap = qjsGetCurFrame().jsvarmap;
            const keyJSVar = qjsJSVarMap.get(keyName)!;

            emitQJSFreeValue(keyJSVar.cvar);

            decreaseQJSIndent();
            writeTokenText(SyntaxKind.CloseBraceToken, writeQJSPunctuation);
            writeQJSLine();

            keyJSVar.cvar.needfree = false;
        }

        function emitQJSForLocalVarDef(node: IterationStatement) {
            if (!printerOptions.emitQJSCode) {
                return;
            }
            const origin_node = getParseTreeNode(node);
            emitQJSVarDefList(origin_node);
        }

        function emitForInStatement(node: ForInStatement) {
            emitQJSForLocalVarDef(node);
            const openParenPos = emitTokenWithComment(SyntaxKind.ForKeyword, node.pos, writeKeyword, node);
            writeSpace();
            emitTokenWithComment(SyntaxKind.OpenParenToken, openParenPos, writePunctuation, node);
            emitForBinding(node.initializer);
            writeSpace();
            emitTokenWithComment(SyntaxKind.InKeyword, node.initializer.end, writeKeyword, node);
            writeSpace();
            emitExpression(node.expression);

            emitQJSForInProlog(node.expression);
            emitTokenWithComment(SyntaxKind.CloseParenToken, node.expression.end, writePunctuation, node);
            emitEmbeddedStatement(node, node.statement);
            emitQJSForInEpilog(node.expression);
        }

        function emitForOfStatement(node: ForOfStatement) {
            const openParenPos = emitTokenWithComment(SyntaxKind.ForKeyword, node.pos, writeKeyword, node);
            writeSpace();
            emitWithTrailingSpace(node.awaitModifier);
            emitTokenWithComment(SyntaxKind.OpenParenToken, openParenPos, writePunctuation, node);
            emitForBinding(node.initializer);
            writeSpace();
            emitTokenWithComment(SyntaxKind.OfKeyword, node.initializer.end, writeKeyword, node);
            writeSpace();
            emitExpression(node.expression);
            emitTokenWithComment(SyntaxKind.CloseParenToken, node.expression.end, writePunctuation, node);
            emitEmbeddedStatement(node, node.statement);
        }

        function emitForBinding(node: VariableDeclarationList | Expression | undefined) {
            if (node !== undefined) {
                if (node.kind === SyntaxKind.VariableDeclarationList) {
                    emit(node);
                }
                else {
                    emitExpression(node);
                }
            }
        }

        function emitContinueStatement(node: ContinueStatement) {
            emitTokenWithComment(SyntaxKind.ContinueKeyword, node.pos, writeKeyword, node);
            emitWithLeadingSpace(node.label);
            writeTrailingSemicolon();
        }

        function emitBreakStatement(node: BreakStatement) {
            emitTokenWithComment(SyntaxKind.BreakKeyword, node.pos, writeKeyword, node);
            emitWithLeadingSpace(node.label);
            writeTrailingSemicolon();
        }

        function emitTokenWithComment(token: SyntaxKind, pos: number, writer: (s: string) => void, contextNode: Node, indentLeading?: boolean) {
            const node = getParseTreeNode(contextNode);
            const isSimilarNode = node && node.kind === contextNode.kind;
            const startPos = pos;
            if (isSimilarNode && currentSourceFile) {
                pos = skipTrivia(currentSourceFile.text, pos);
            }
            if (isSimilarNode && contextNode.pos !== startPos) {
                const needsIndent = indentLeading && currentSourceFile && !positionsAreOnSameLine(startPos, pos, currentSourceFile);
                if (needsIndent) {
                    increaseIndent();
                }
                emitLeadingCommentsOfPosition(startPos);
                if (needsIndent) {
                    decreaseIndent();
                }
            }
            pos = writeTokenText(token, writer, pos);
            if (isSimilarNode && contextNode.end !== pos) {
                const isJsxExprContext = contextNode.kind === SyntaxKind.JsxExpression;
                emitTrailingCommentsOfPosition(pos, /*prefixSpace*/ !isJsxExprContext, /*forceNoNewline*/ isJsxExprContext);
            }
            return pos;
        }

        function commentWillEmitNewLine(node: CommentRange) {
            return node.kind === SyntaxKind.SingleLineCommentTrivia || !!node.hasTrailingNewLine;
        }

        function willEmitLeadingNewLine(node: Expression): boolean {
            if (!currentSourceFile) return false;
            if (some(getLeadingCommentRanges(currentSourceFile.text, node.pos), commentWillEmitNewLine)) return true;
            if (some(getSyntheticLeadingComments(node), commentWillEmitNewLine)) return true;
            if (isPartiallyEmittedExpression(node)) {
                if (node.pos !== node.expression.pos) {
                    if (some(getTrailingCommentRanges(currentSourceFile.text, node.expression.pos), commentWillEmitNewLine)) return true;
                }
                return willEmitLeadingNewLine(node.expression);
            }
            return false;
        }

        /**
         * Wraps an expression in parens if we would emit a leading comment that would introduce a line separator
         * between the node and its parent.
         */
        function parenthesizeExpressionForNoAsi(node: Expression) {
            if (!commentsDisabled && isPartiallyEmittedExpression(node) && willEmitLeadingNewLine(node)) {
                const parseNode = getParseTreeNode(node);
                if (parseNode && isParenthesizedExpression(parseNode)) {
                    // If the original node was a parenthesized expression, restore it to preserve comment and source map emit
                    const parens = factory.createParenthesizedExpression(node.expression);
                    setOriginalNode(parens, node);
                    setTextRange(parens, parseNode);
                    return parens;
                }
                return factory.createParenthesizedExpression(node);
            }
            return node;
        }

        function parenthesizeExpressionForNoAsiAndDisallowedComma(node: Expression) {
            return parenthesizeExpressionForNoAsi(parenthesizer.parenthesizeExpressionForDisallowedComma(node));
        }

        function emitQJSReturnStatement() {
            if (!printerOptions.emitQJSCode) {
                return;
            }

            const qjsVar = popQJSValueStack();
            qjsVar.needfree = false;

            emitQJSFreeVars(true);

            writeQJSKeyword(QJSReserved.Return);
            writeQJSSpace();
            if (qjsVar.type !== QJSCType.JSValue) {
                writeQJSKeyword(generateQJSMKVal(qjsVar));
            }
            else {
                writeQJSKeyword(qjsVar.name);
            }
            writeQJSTrailingSemicolon();
            writeQJSLine();

            qjsGetCurFrame().needEmitReturn = false;
        }

        function emitReturnStatement(node: ReturnStatement) {
            qjsEmitterState = QJSValueStackState.RValue;
            emitTokenWithComment(SyntaxKind.ReturnKeyword, node.pos, writeKeyword, /*contextNode*/ node);
            emitExpressionWithLeadingSpace(node.expression && parenthesizeExpressionForNoAsi(node.expression), parenthesizeExpressionForNoAsi);
            writeTrailingSemicolon();

            emitQJSReturnStatement();
        }

        function emitWithStatement(node: WithStatement) {
            const openParenPos = emitTokenWithComment(SyntaxKind.WithKeyword, node.pos, writeKeyword, node);
            writeSpace();
            emitTokenWithComment(SyntaxKind.OpenParenToken, openParenPos, writePunctuation, node);
            emitExpression(node.expression);
            emitTokenWithComment(SyntaxKind.CloseParenToken, node.expression.end, writePunctuation, node);
            emitEmbeddedStatement(node, node.statement);
        }

        function emitSwitchStatement(node: SwitchStatement) {
            const openParenPos = emitTokenWithComment(SyntaxKind.SwitchKeyword, node.pos, writeKeyword, node);
            writeSpace();
            emitTokenWithComment(SyntaxKind.OpenParenToken, openParenPos, writePunctuation, node);
            emitExpression(node.expression);
            emitTokenWithComment(SyntaxKind.CloseParenToken, node.expression.end, writePunctuation, node);
            writeSpace();
            emit(node.caseBlock);
        }

        function emitLabeledStatement(node: LabeledStatement) {
            emit(node.label);
            emitTokenWithComment(SyntaxKind.ColonToken, node.label.end, writePunctuation, node);
            writeSpace();
            emit(node.statement);
        }

        function isQJSInTryBlock(node: Node): boolean {
            let cur = node;
            while (cur) {
                if (cur.kind === SyntaxKind.TryStatement) {
                    return true;
                }

                if (cur.kind === SyntaxKind.FunctionDeclaration) {
                    break;
                }

                cur = cur.parent;
            }
            return false;
        }

        function emitQJSThrowStatement(node: ThrowStatement) {
            if (!printerOptions.emitQJSCode) {
                return;
            }

            const exceptionObj = popQJSValueStack();

            if (isQJSInTryBlock(node)) {
                writeQJSKeyword(QJSReserved.Throw);
                writeQJSPunctuation("(");
                writeQJSBase(exceptionObj.name);
                writeQJSPunctuation(")");
                writeQJSTrailingSemicolon();
                writeQJSLine();
                exceptionObj.needfree = false;
            }
            else {
                // get exception
                // throw it by c/c++
            }
        }

        function emitThrowStatement(node: ThrowStatement) {
            emitTokenWithComment(SyntaxKind.ThrowKeyword, node.pos, writeKeyword, node);
            qjsEmitterState = QJSValueStackState.RValue;
            emitExpressionWithLeadingSpace(parenthesizeExpressionForNoAsi(node.expression), parenthesizeExpressionForNoAsi);
            emitQJSThrowStatement(node);
            writeTrailingSemicolon();
        }

        function emitQJSTry() {
            if (!printerOptions.emitQJSCode) {
                return;
            }

            if (qjsConfig.useCPlusPlus) {
                writeQJSKeyword(QJSReserved.Try);
            }

            writeQJSSpace();

            qjsCurBlockType = QJSBlockType.Try;
        }
        function emitTryStatement(node: TryStatement) {
            emitTokenWithComment(SyntaxKind.TryKeyword, node.pos, writeKeyword, node);
            emitQJSTry();
            writeSpace();
            emit(node.tryBlock);
            if (node.catchClause) {
                writeLineOrSpace(node, node.tryBlock, node.catchClause);
                emit(node.catchClause);
            }
            if (node.finallyBlock) {
                writeLineOrSpace(node, node.catchClause || node.tryBlock, node.finallyBlock);
                emitTokenWithComment(SyntaxKind.FinallyKeyword, (node.catchClause || node.tryBlock).end, writeKeyword, node);
                writeSpace();
                emit(node.finallyBlock);
            }
        }

        function emitDebuggerStatement(node: DebuggerStatement) {
            writeToken(SyntaxKind.DebuggerKeyword, node.pos, writeKeyword);
            writeTrailingSemicolon();
        }

        //
        // Declarations
        //
        function prepareQJSTempVar(ctype: QJSCType, jstype: QJSJSType): QJSVar {
            const qjsVarName = generateQJSTempVarName(ctype);
            const qjsVar = qjsNewVar(undefined, ctype, qjsVarName);

            qjsVar.jstype = jstype;
            if (jstype < QJSJSType.RefType) {
                qjsVar.needfree = false;
            }

            pushQJSValueStack(qjsVar);
            return qjsVar;
        }

        function pushQJSValueStack(qjsVar: QJSVar) {
            qjsValueStack.push(qjsVar);
        }

        function popQJSValueStack(): QJSVar {
            const qjsVar = qjsValueStack.pop()!;
            Debug.assert(qjsVar, "qjs emitter: value stack is empty.");
            return qjsVar;
        }

        function peekQJSValueStack(): QJSVar {
            const qjsVar = qjsValueStack[qjsValueStack.length - 1];
            return qjsVar;
        }
/*
        function emitQJSSetTag(tagName: string, tag: string) {
            writeQJSKeyword(tagName);
            writeQJSSpace();
            writeQJSOperator("=");
            writeQJSSpace();
            writeQJSBase(tag);
            writeQJSTrailingSemicolon();
            writeQJSLine();
        }

        function emitQJSTagCast(qjsVar: QJSVar, ctype: QJSCType.Int | QJSCType.Double) {
            if (ctype === QJSCType.Int) {
                emitQJSSetTag(qjsVar.name, QJSReserved.JS_TAG_INT);
            }
            else {
                emitQJSSetTag(qjsVar.name, QJSReserved.JS_TAG_FLOAT64);
            }
        }

        function qjsRecordExpression(op: string, object: string, prop: string, val: QJSVar) {
            qjsExprMap.set(op + object + prop, val);
        }

        function qjsFindCommonExpress(op: string, object: string, prop: string): QJSVar | undefined {
            return qjsExprMap.get(op + object + prop);
        }

        function qjsUpdateVarMap(name: string, qjsVar: QJSVar, needsync = false) {
            const qjsJSVarMap = qjsGetCurFrame().jsvarmap;
            const jsVar = qjsJSVarMap.get(name)!;
            Debug.assert(jsVar);
            jsVar.cvar = qjsVar;
            jsVar.needsync = needsync;
            qjsVar.jsvar = jsVar;

            //dont forget to update valuestack
            //qjsValueStack.forEach((value, index, array) => {
            //    if (value.jsvar && value.jsvar === jsVar) {
            //        array[index] = qjsVar;
            //    }
            //});
        }

        function qjsUpdateVarMapByJSVar(jsVar: QJSJSVar, qjsVar: QJSVar, needsync = false) {
            jsVar.cvar = qjsVar;
            jsVar.needsync = needsync;
            qjsVar.jsvar = jsVar;

            //dont forget to update valuestack
            qjsValueStack.forEach((value, index, array) => {
                if (value.jsvar && value.jsvar === jsVar) {
                    array[index] = qjsVar;
                }
            });
        }
*/
        function emitQJSNumberTypeAssignmentCast(qjsVar: QJSVar, qjsVal: QJSVar) {
            switch (qjsVar.type) {
                case QJSCType.Int:
                    break;
                case QJSCType.Double:
                    break;
                case QJSCType.JSValue:
                    writeQJSBase(generateQJSSetTempValue(qjsVar, qjsVal));
                    writeQJSTrailingSemicolon();
                    writeQJSLine(2);
                    break;
                default:
                    Debug.fail("qjs emitter: wrong type in generateQJSNumberTypeCast.");
                    break;
            }
        }

        function emitQJSVariableDeclaration(node: VariableDeclaration) {
            if (!printerOptions.emitQJSCode) {
                return;
            }

            //if ((node.parent && isLet(node.parent)) || isLet(node) ||
            //    isVarConst(node)) {
                // put_var_init
                let qjsVal: QJSVar | undefined;
                if (node.initializer) {
                    qjsVal = popQJSValueStack();
                }

                const qjsVar = popQJSValueStack();

                const originNode = getParseTreeNode(node);
                if (!!originNode && !!originNode.parent && originNode.parent.kind === SyntaxKind.CatchClause) {
                    qjsVal = popQJSValueStack();
                }

                if (!qjsVal) {
                    return;
                }

                if (qjsVar === qjsVal) {
                    qjsVar.jsvar!.needsync = true;
                    qjsVar.jsvar!.inited = true;
                    writeQJSLine(2);
                    return;
                }

                switch (qjsVal.type) {
                    case QJSCType.Number:
                    case QJSCType.Tag:
                        // don't know value's type exactly, go runtime conversion path
                        Debug.fail("qjs emitter: unsupported now slow path.");
                        break;
                    case QJSCType.IntLiteral:
                    case QJSCType.FloatLiteral:
                    case QJSCType.Int:
                    case QJSCType.Double:
                    case QJSCType.Bool:
                        // already know value's type
                        if (qjsVar.type === qjsVal.type) {
                            Debug.fail("qjs emitter: unsupported variable initializer type.");
                        }
                        else {
                            emitQJSNumberTypeAssignmentCast(qjsVar, qjsVal);
                        }
                        break;
                    case QJSCType.JSValue:
                        if (qjsVal.jsvar &&
                            qjsVal.jsvar.kind === QJSJSVarKind.GlobalVar &&
                            !qjsVal.jsvar.inited) {
                            emitQJSInitGlobalVar(qjsVal);
                        }

                        writeQJSBase(generateQJSSetValue(qjsVar, qjsVal));
                        writeQJSTrailingSemicolon();
                        writeQJSLine(2);
                        break;
                    default:
                        Debug.log("qjs emitter: unsupported variable initializer type.");
                        break;
                }
            //}
        }

        function emitVariableDeclaration(node: VariableDeclaration) {
            qjsEmitterState = QJSValueStackState.LValue;
            emit(node.name);
            emit(node.exclamationToken);
            emitTypeAnnotation(node.type);
            qjsEmitterState = QJSValueStackState.RValue;
            emitInitializer(node.initializer, node.type?.end ?? node.name.emitNode?.typeNode?.end ?? node.name.end, node, parenthesizer.parenthesizeExpressionForDisallowedComma);
            qjsEmitterState = QJSValueStackState.None;

            emitQJSVariableDeclaration(node);
        }

        function emitVariableDeclarationList(node: VariableDeclarationList) {
            writeKeyword(isLet(node) ? "let" : isVarConst(node) ? "const" : "var");
            writeSpace();
            emitList(node, node.declarations, ListFormat.VariableDeclarationList);
        }

        function emitFunctionDeclaration(node: FunctionDeclaration) {
            emitFunctionDeclarationOrExpression(node);
        }

        function emitFunctionDeclarationOrExpression(node: FunctionDeclaration | FunctionExpression) {
            emitDecorators(node, node.decorators);
            emitModifiers(node, node.modifiers);
            writeKeyword("function");
            emit(node.asteriskToken);
            writeSpace();

            qjsEmitterState = QJSValueStackState.RValue;
            emitIdentifierName(node.name);
            qjsEmitterState = QJSValueStackState.None;
            // qjs emitter
            if (!!printerOptions.emitQJSCode) {
                const func = popQJSValueStack();
                emitQJSFunctionBegin(node, QJSReserved.FuncPrefix, func.jsvar!.name, QJSCType.JSValue);
                const origin_node = getParseTreeNode(node);
                emitQJSVarDefList(origin_node);
            }

            emitSignatureAndBody(node, emitSignatureHead);

            // qjs emitter
            if (!!printerOptions.emitQJSCode) {
                emitQJSFunctionEnd(node);
            }
        }

        function emitSignatureAndBody(node: FunctionLikeDeclaration, emitSignatureHead: (node: SignatureDeclaration) => void) {
            const body = node.body;
            if (body) {
                if (isBlock(body)) {
                    const indentedFlag = getEmitFlags(node) & EmitFlags.Indented;
                    if (indentedFlag) {
                        increaseIndent();
                    }

                    pushNameGenerationScope(node);
                    forEach(node.parameters, generateNames);
                    generateNames(node.body);

                    emitSignatureHead(node);
                    emitBlockFunctionBody(body);
                    popNameGenerationScope(node);

                    if (indentedFlag) {
                        decreaseIndent();
                    }
                }
                else {
                    emitSignatureHead(node);
                    writeSpace();
                    emitExpression(body, parenthesizer.parenthesizeConciseBodyOfArrowFunction);
                }
            }
            else {
                emitSignatureHead(node);
                writeTrailingSemicolon();
            }

        }

        function emitSignatureHead(node: FunctionDeclaration | FunctionExpression | MethodDeclaration | AccessorDeclaration | ConstructorDeclaration) {
            emitTypeParameters(node, node.typeParameters);
            emitParameters(node, node.parameters);
            emitTypeAnnotation(node.type);
        }

        function shouldEmitBlockFunctionBodyOnSingleLine(body: Block) {
            // We must emit a function body as a single-line body in the following case:
            // * The body has NodeEmitFlags.SingleLine specified.

            // We must emit a function body as a multi-line body in the following cases:
            // * The body is explicitly marked as multi-line.
            // * A non-synthesized body's start and end position are on different lines.
            // * Any statement in the body starts on a new line.

            if (getEmitFlags(body) & EmitFlags.SingleLine) {
                return true;
            }

            if (body.multiLine) {
                return false;
            }

            if (!nodeIsSynthesized(body) && !rangeIsOnSingleLine(body, currentSourceFile!)) {
                return false;
            }

            if (getLeadingLineTerminatorCount(body, body.statements, ListFormat.PreserveLines)
                || getClosingLineTerminatorCount(body, body.statements, ListFormat.PreserveLines)) {
                return false;
            }

            let previousStatement: Statement | undefined;
            for (const statement of body.statements) {
                if (getSeparatingLineTerminatorCount(previousStatement, statement, ListFormat.PreserveLines) > 0) {
                    return false;
                }

                previousStatement = statement;
            }

            return true;
        }

        function emitBlockFunctionBody(body: Block) {
            onBeforeEmitNode?.(body);
            writeSpace();
            writePunctuation("{");
            increaseIndent();

            const emitBlockFunctionBody = shouldEmitBlockFunctionBodyOnSingleLine(body)
                ? emitBlockFunctionBodyOnSingleLine
                : emitBlockFunctionBodyWorker;

            if (emitBodyWithDetachedComments) {
                emitBodyWithDetachedComments(body, body.statements, emitBlockFunctionBody);
            }
            else {
                emitBlockFunctionBody(body);
            }

            decreaseIndent();
            writeToken(SyntaxKind.CloseBraceToken, body.statements.end, writePunctuation, body);
            onAfterEmitNode?.(body);
        }

        function emitBlockFunctionBodyOnSingleLine(body: Block) {
            emitBlockFunctionBodyWorker(body, /*emitBlockFunctionBodyOnSingleLine*/ true);
        }

        function emitBlockFunctionBodyWorker(body: Block, emitBlockFunctionBodyOnSingleLine?: boolean) {
            // Emit all the prologue directives (like "use strict").
            const statementOffset = emitPrologueDirectives(body.statements);
            const pos = writer.getTextPos();
            emitHelpers(body);
            if (statementOffset === 0 && pos === writer.getTextPos() && emitBlockFunctionBodyOnSingleLine) {
                decreaseIndent();
                emitList(body, body.statements, ListFormat.SingleLineFunctionBodyStatements);
                increaseIndent();
            }
            else {
                emitList(body, body.statements, ListFormat.MultiLineFunctionBodyStatements, /*parenthesizerRule*/ undefined, statementOffset);
            }
        }

        function emitClassDeclaration(node: ClassDeclaration) {
            emitClassDeclarationOrExpression(node);
        }

        function emitClassDeclarationOrExpression(node: ClassDeclaration | ClassExpression) {
            forEach(node.members, generateMemberNames);

            emitDecorators(node, node.decorators);
            emitModifiers(node, node.modifiers);
            writeKeyword("class");
            if (node.name) {
                writeSpace();
                emitIdentifierName(node.name);
            }

            const indentedFlag = getEmitFlags(node) & EmitFlags.Indented;
            if (indentedFlag) {
                increaseIndent();
            }

            if (!!printerOptions.emitQJSCode) {
                emitQJSClassDeclarationPrologue(node);
            }

            emitTypeParameters(node, node.typeParameters);
            emitList(node, node.heritageClauses, ListFormat.ClassHeritageClauses);

            writeSpace();
            writePunctuation("{");
            emitList(node, node.members, ListFormat.ClassMembers);
            writePunctuation("}");

            if (indentedFlag) {
                decreaseIndent();
            }

            function emitQJSClassDeclarationPrologue(node: ClassDeclaration | ClassExpression) {
                if (!node.heritageClauses) {
                    // not extends
                    const jsName = getTextOfNode(node.name!, false);
                    const varAtomName = qjsTypeInfo[QJSCType.JSAtom].prefix + jsName;
                    const qjsAtomVar = qjsNewVar(undefined, QJSCType.JSAtom, varAtomName, true, true);
                    qjsAtomMap.set(jsName, qjsAtomVar);

                    const jsCtor = node.members.find(((m) => {
                        return m.kind === SyntaxKind.Constructor;
                    }));
                    let qjsCtorVar: QJSVar | undefined;;
                    if (!!jsCtor) {
                        // has constructor defined.
                        qjsCtorVar = emitQJSClassConstructor(jsCtor as ConstructorDeclaration);
                    }
                    else {
                        qjsCtorVar = undefined;
                    }

                    //const  ctor_name = QJSReserved.FuncPrefix + "ctor_" + jsName;
                    if (!!qjsCtorVar) {
                        writeQJSBase(generateQJSJSDefineClass(qjsCtorVar, qjsAtomVar));
                        writeQJSTrailingSemicolon();
                    }
                }
                else {
                    // TODO
                    // extends parent class
                }


                function emitQJSClassConstructor(ctor: ConstructorDeclaration): QJSVar {
                    writeQJSKeyword(qjsTypeInfo[QJSCType.JSValue].type);
                    writeQJSSpace();
                    const tempVar = prepareQJSTempVar(QJSCType.JSValue, QJSJSType.Object);
                    popQJSValueStack();
                    emitQJSNewCFunction2(tempVar, "constructor", ctor.parameters.length, QJSReserved.JS_CFUNC_constructor);
                    return tempVar;
                }
            }
        }

        function emitInterfaceDeclaration(node: InterfaceDeclaration) {
            emitDecorators(node, node.decorators);
            emitModifiers(node, node.modifiers);
            writeKeyword("interface");
            writeSpace();
            emit(node.name);
            emitTypeParameters(node, node.typeParameters);
            emitList(node, node.heritageClauses, ListFormat.HeritageClauses);
            writeSpace();
            writePunctuation("{");
            emitList(node, node.members, ListFormat.InterfaceMembers);
            writePunctuation("}");
        }

        function emitTypeAliasDeclaration(node: TypeAliasDeclaration) {
            emitDecorators(node, node.decorators);
            emitModifiers(node, node.modifiers);
            writeKeyword("type");
            writeSpace();
            emit(node.name);
            emitTypeParameters(node, node.typeParameters);
            writeSpace();
            writePunctuation("=");
            writeSpace();
            emit(node.type);
            writeTrailingSemicolon();
        }

        function emitEnumDeclaration(node: EnumDeclaration) {
            emitModifiers(node, node.modifiers);
            writeKeyword("enum");
            writeSpace();
            emit(node.name);

            writeSpace();
            writePunctuation("{");
            emitList(node, node.members, ListFormat.EnumMembers);
            writePunctuation("}");
        }

        function emitModuleDeclaration(node: ModuleDeclaration) {
            emitModifiers(node, node.modifiers);
            if (~node.flags & NodeFlags.GlobalAugmentation) {
                writeKeyword(node.flags & NodeFlags.Namespace ? "namespace" : "module");
                writeSpace();
            }
            emit(node.name);

            let body = node.body;
            if (!body) return writeTrailingSemicolon();
            while (body && isModuleDeclaration(body)) {
                writePunctuation(".");
                emit(body.name);
                body = body.body;
            }

            writeSpace();
            emit(body);
        }

        function emitModuleBlock(node: ModuleBlock) {
            pushNameGenerationScope(node);
            forEach(node.statements, generateNames);
            emitBlockStatements(node, /*forceSingleLine*/ isEmptyBlock(node));
            popNameGenerationScope(node);
        }

        function emitCaseBlock(node: CaseBlock) {
            emitTokenWithComment(SyntaxKind.OpenBraceToken, node.pos, writePunctuation, node);
            emitList(node, node.clauses, ListFormat.CaseBlockClauses);
            emitTokenWithComment(SyntaxKind.CloseBraceToken, node.clauses.end, writePunctuation, node, /*indentLeading*/ true);
        }

        function emitImportEqualsDeclaration(node: ImportEqualsDeclaration) {
            emitModifiers(node, node.modifiers);
            emitTokenWithComment(SyntaxKind.ImportKeyword, node.modifiers ? node.modifiers.end : node.pos, writeKeyword, node);
            writeSpace();
            if (node.isTypeOnly) {
                emitTokenWithComment(SyntaxKind.TypeKeyword, node.pos, writeKeyword, node);
                writeSpace();
            }
            emit(node.name);
            writeSpace();
            emitTokenWithComment(SyntaxKind.EqualsToken, node.name.end, writePunctuation, node);
            writeSpace();
            emitModuleReference(node.moduleReference);
            writeTrailingSemicolon();
        }

        function emitModuleReference(node: ModuleReference) {
            if (node.kind === SyntaxKind.Identifier) {
                emitExpression(node);
            }
            else {
                emit(node);
            }
        }

        function emitImportDeclaration(node: ImportDeclaration) {
            emitModifiers(node, node.modifiers);
            emitTokenWithComment(SyntaxKind.ImportKeyword, node.modifiers ? node.modifiers.end : node.pos, writeKeyword, node);
            writeSpace();
            if (node.importClause) {
                emit(node.importClause);
                writeSpace();
                emitTokenWithComment(SyntaxKind.FromKeyword, node.importClause.end, writeKeyword, node);
                writeSpace();
            }
            emitExpression(node.moduleSpecifier);
            if (node.assertClause) {
                emitWithLeadingSpace(node.assertClause);
            }
            writeTrailingSemicolon();
        }

        function emitImportClause(node: ImportClause) {
            if (node.isTypeOnly) {
                emitTokenWithComment(SyntaxKind.TypeKeyword, node.pos, writeKeyword, node);
                writeSpace();
            }
            emit(node.name);
            if (node.name && node.namedBindings) {
                emitTokenWithComment(SyntaxKind.CommaToken, node.name.end, writePunctuation, node);
                writeSpace();
            }
            emit(node.namedBindings);
        }

        function emitNamespaceImport(node: NamespaceImport) {
            const asPos = emitTokenWithComment(SyntaxKind.AsteriskToken, node.pos, writePunctuation, node);
            writeSpace();
            emitTokenWithComment(SyntaxKind.AsKeyword, asPos, writeKeyword, node);
            writeSpace();
            emit(node.name);
        }

        function emitNamedImports(node: NamedImports) {
            emitNamedImportsOrExports(node);
        }

        function emitImportSpecifier(node: ImportSpecifier) {
            emitImportOrExportSpecifier(node);
        }

        function emitExportAssignment(node: ExportAssignment) {
            const nextPos = emitTokenWithComment(SyntaxKind.ExportKeyword, node.pos, writeKeyword, node);
            writeSpace();
            if (node.isExportEquals) {
                emitTokenWithComment(SyntaxKind.EqualsToken, nextPos, writeOperator, node);
            }
            else {
                emitTokenWithComment(SyntaxKind.DefaultKeyword, nextPos, writeKeyword, node);
            }
            writeSpace();
            emitExpression(node.expression, node.isExportEquals ?
                parenthesizer.getParenthesizeRightSideOfBinaryForOperator(SyntaxKind.EqualsToken) :
                parenthesizer.parenthesizeExpressionOfExportDefault);
            writeTrailingSemicolon();
        }

        function emitExportDeclaration(node: ExportDeclaration) {
            let nextPos = emitTokenWithComment(SyntaxKind.ExportKeyword, node.pos, writeKeyword, node);
            writeSpace();
            if (node.isTypeOnly) {
                nextPos = emitTokenWithComment(SyntaxKind.TypeKeyword, nextPos, writeKeyword, node);
                writeSpace();
            }
            if (node.exportClause) {
                emit(node.exportClause);
            }
            else {
                nextPos = emitTokenWithComment(SyntaxKind.AsteriskToken, nextPos, writePunctuation, node);
            }
            if (node.moduleSpecifier) {
                writeSpace();
                const fromPos = node.exportClause ? node.exportClause.end : nextPos;
                emitTokenWithComment(SyntaxKind.FromKeyword, fromPos, writeKeyword, node);
                writeSpace();
                emitExpression(node.moduleSpecifier);
            }
            if (node.assertClause) {
                emitWithLeadingSpace(node.assertClause);
            }
            writeTrailingSemicolon();
        }

        function emitAssertClause(node: AssertClause) {
            emitTokenWithComment(SyntaxKind.AssertKeyword, node.pos, writeKeyword, node);
            writeSpace();
            const elements = node.elements;
            emitList(node, elements, ListFormat.ImportClauseEntries);
        }

        function emitAssertEntry(node: AssertEntry) {
            emit(node.name);
            writePunctuation(":");
            writeSpace();

            const value = node.value;
            /** @see {emitPropertyAssignment} */
            if ((getEmitFlags(value) & EmitFlags.NoLeadingComments) === 0) {
                const commentRange = getCommentRange(value);
                emitTrailingCommentsOfPosition(commentRange.pos);
            }
            emit(value);
        }

        function emitNamespaceExportDeclaration(node: NamespaceExportDeclaration) {
            let nextPos = emitTokenWithComment(SyntaxKind.ExportKeyword, node.pos, writeKeyword, node);
            writeSpace();
            nextPos = emitTokenWithComment(SyntaxKind.AsKeyword, nextPos, writeKeyword, node);
            writeSpace();
            nextPos = emitTokenWithComment(SyntaxKind.NamespaceKeyword, nextPos, writeKeyword, node);
            writeSpace();
            emit(node.name);
            writeTrailingSemicolon();
        }

        function emitNamespaceExport(node: NamespaceExport) {
            const asPos = emitTokenWithComment(SyntaxKind.AsteriskToken, node.pos, writePunctuation, node);
            writeSpace();
            emitTokenWithComment(SyntaxKind.AsKeyword, asPos, writeKeyword, node);
            writeSpace();
            emit(node.name);
        }

        function emitNamedExports(node: NamedExports) {
            emitNamedImportsOrExports(node);
        }

        function emitExportSpecifier(node: ExportSpecifier) {
            emitImportOrExportSpecifier(node);
        }

        function emitNamedImportsOrExports(node: NamedImportsOrExports) {
            writePunctuation("{");
            emitList(node, node.elements, ListFormat.NamedImportsOrExportsElements);
            writePunctuation("}");
        }

        function emitImportOrExportSpecifier(node: ImportOrExportSpecifier) {
            if (node.isTypeOnly) {
                writeKeyword("type");
                writeSpace();
            }
            if (node.propertyName) {
                emit(node.propertyName);
                writeSpace();
                emitTokenWithComment(SyntaxKind.AsKeyword, node.propertyName.end, writeKeyword, node);
                writeSpace();
            }

            emit(node.name);
        }

        //
        // Module references
        //

        function emitExternalModuleReference(node: ExternalModuleReference) {
            writeKeyword("require");
            writePunctuation("(");
            emitExpression(node.expression);
            writePunctuation(")");
        }

        //
        // JSX
        //

        function emitJsxElement(node: JsxElement) {
            emit(node.openingElement);
            emitList(node, node.children, ListFormat.JsxElementOrFragmentChildren);
            emit(node.closingElement);
        }

        function emitJsxSelfClosingElement(node: JsxSelfClosingElement) {
            writePunctuation("<");
            emitJsxTagName(node.tagName);
            emitTypeArguments(node, node.typeArguments);
            writeSpace();
            emit(node.attributes);
            writePunctuation("/>");
        }

        function emitJsxFragment(node: JsxFragment) {
            emit(node.openingFragment);
            emitList(node, node.children, ListFormat.JsxElementOrFragmentChildren);
            emit(node.closingFragment);
        }

        function emitJsxOpeningElementOrFragment(node: JsxOpeningElement | JsxOpeningFragment) {
            writePunctuation("<");

            if (isJsxOpeningElement(node)) {
                const indented = writeLineSeparatorsAndIndentBefore(node.tagName, node);
                emitJsxTagName(node.tagName);
                emitTypeArguments(node, node.typeArguments);
                if (node.attributes.properties && node.attributes.properties.length > 0) {
                    writeSpace();
                }
                emit(node.attributes);
                writeLineSeparatorsAfter(node.attributes, node);
                decreaseIndentIf(indented);
            }

            writePunctuation(">");
        }

        function emitJsxText(node: JsxText) {
            writer.writeLiteral(node.text);
        }

        function emitJsxClosingElementOrFragment(node: JsxClosingElement | JsxClosingFragment) {
            writePunctuation("</");
            if (isJsxClosingElement(node)) {
                emitJsxTagName(node.tagName);
            }
            writePunctuation(">");
        }

        function emitJsxAttributes(node: JsxAttributes) {
            emitList(node, node.properties, ListFormat.JsxElementAttributes);
        }

        function emitJsxAttribute(node: JsxAttribute) {
            emit(node.name);
            emitNodeWithPrefix("=", writePunctuation, node.initializer, emitJsxAttributeValue);
        }

        function emitJsxSpreadAttribute(node: JsxSpreadAttribute) {
            writePunctuation("{...");
            emitExpression(node.expression);
            writePunctuation("}");
        }

        function hasTrailingCommentsAtPosition(pos: number) {
            let result = false;
            forEachTrailingCommentRange(currentSourceFile?.text || "", pos + 1, () => result = true);
            return result;
        }

        function hasLeadingCommentsAtPosition(pos: number) {
            let result = false;
            forEachLeadingCommentRange(currentSourceFile?.text || "", pos + 1, () => result = true);
            return result;
        }

        function hasCommentsAtPosition(pos: number) {
            return hasTrailingCommentsAtPosition(pos) || hasLeadingCommentsAtPosition(pos);
        }

        function emitJsxExpression(node: JsxExpression) {
            if (node.expression || (!commentsDisabled && !nodeIsSynthesized(node) && hasCommentsAtPosition(node.pos))) { // preserve empty expressions if they contain comments!
                const isMultiline = currentSourceFile && !nodeIsSynthesized(node) && getLineAndCharacterOfPosition(currentSourceFile, node.pos).line !== getLineAndCharacterOfPosition(currentSourceFile, node.end).line;
                if (isMultiline) {
                    writer.increaseIndent();
                }
                const end = emitTokenWithComment(SyntaxKind.OpenBraceToken, node.pos, writePunctuation, node);
                emit(node.dotDotDotToken);
                emitExpression(node.expression);
                emitTokenWithComment(SyntaxKind.CloseBraceToken, node.expression?.end || end, writePunctuation, node);
                if (isMultiline) {
                    writer.decreaseIndent();
                }
            }
        }

        function emitJsxTagName(node: JsxTagNameExpression) {
            if (node.kind === SyntaxKind.Identifier) {
                emitExpression(node);
            }
            else {
                emit(node);
            }
        }

        //
        // Clauses
        //

        function emitCaseClause(node: CaseClause) {
            emitTokenWithComment(SyntaxKind.CaseKeyword, node.pos, writeKeyword, node);
            writeSpace();
            emitExpression(node.expression, parenthesizer.parenthesizeExpressionForDisallowedComma);

            emitCaseOrDefaultClauseRest(node, node.statements, node.expression.end);
        }

        function emitDefaultClause(node: DefaultClause) {
            const pos = emitTokenWithComment(SyntaxKind.DefaultKeyword, node.pos, writeKeyword, node);
            emitCaseOrDefaultClauseRest(node, node.statements, pos);
        }

        function emitCaseOrDefaultClauseRest(parentNode: Node, statements: NodeArray<Statement>, colonPos: number) {
            const emitAsSingleStatement =
                statements.length === 1 &&
                (
                    // treat synthesized nodes as located on the same line for emit purposes
                    nodeIsSynthesized(parentNode) ||
                    nodeIsSynthesized(statements[0]) ||
                    rangeStartPositionsAreOnSameLine(parentNode, statements[0], currentSourceFile!)
                );

            let format = ListFormat.CaseOrDefaultClauseStatements;
            if (emitAsSingleStatement) {
                writeToken(SyntaxKind.ColonToken, colonPos, writePunctuation, parentNode);
                writeSpace();
                format &= ~(ListFormat.MultiLine | ListFormat.Indented);
            }
            else {
                emitTokenWithComment(SyntaxKind.ColonToken, colonPos, writePunctuation, parentNode);
            }
            emitList(parentNode, statements, format);
        }

        function emitHeritageClause(node: HeritageClause) {
            writeSpace();
            writeTokenText(node.token, writeKeyword);
            writeSpace();
            emitList(node, node.types, ListFormat.HeritageClauseTypes);
        }

        function emitQJSCatchBegin(node: CatchClause) {
            if (!printerOptions.emitQJSCode) {
                return;
            }

            if (qjsConfig.useCPlusPlus) {
                writeQJSKeyword(QJSReserved.Catch);
            }

            writeQJSSpace();

            qjsCurBlockType = QJSBlockType.Catch;

            Debug.assert(node.locals!.size === 1);
            writeQJSPunctuation("(");
            writeQJSKeyword(qjsTypeInfo[QJSCType.JSValue].type);
            writeQJSSpace();

            const exceptionObj = prepareQJSTempVar(QJSCType.JSValue, QJSJSType.Unknown);
            writeQJSBase(exceptionObj.name);

            writeQJSPunctuation(")");
            writeQJSSpace();
            emitQJSBlockBegin(node);
            emitQJSVarDefList(node);
        }

        function emitQJSCatchEnd() {
            if (!printerOptions.emitQJSCode) {
                return;
            }

            emitQJSBlockEnd();
        }

        function emitCatchClause(node: CatchClause) {
            const openParenPos = emitTokenWithComment(SyntaxKind.CatchKeyword, node.pos, writeKeyword, node);
            emitQJSCatchBegin(node);
            writeSpace();
            if (node.variableDeclaration) {
                emitTokenWithComment(SyntaxKind.OpenParenToken, openParenPos, writePunctuation, node);
                emit(node.variableDeclaration);
                emitTokenWithComment(SyntaxKind.CloseParenToken, node.variableDeclaration.end, writePunctuation, node);
                writeSpace();
            }
            emit(node.block);

            emitQJSCatchEnd();
        }

        //
        // Property assignments
        //

        function emitQJSPropertyAssignment(node: PropertyName) {
            const qjsRight = popQJSValueStack();
            const qjsLeft = peekQJSValueStack();
            const propName = getTextOfNode(node, false);
            const propAtom = qjsAtomMap.get(propName)!;
            const jsVar = qjsNewJSVar(generateQJSPropSymbol(qjsLeft, propName), qjsRight.jstype, QJSJSVarKind.Prop, qjsRight);
            if (qjsLeft.jsvar) {
                qjsLeft.jsvar.uses.push(jsVar);
            }
            //const qjsJSVarMap = qjsGetCurFrame().jsvarmap;
            //qjsJSVarMap.set(generateQJSPropSymbol(qjsLeft, propAtom.name), jsvar);

            let val = "";
            switch (qjsRight.type) {
                case QJSCType.IntLiteral:
                case QJSCType.FloatLiteral:
                case QJSCType.Int:
                case QJSCType.Double:
                    val = generateQJSMKVal(qjsRight);
                    break;
                case QJSCType.JSValue:
                    val = qjsRight.name;
                    break;
                default:
                    Debug.fail("qjs emitter: unsupported type now.");
                    break;
            }
            writeQJSBase(generateQJSDefinePropertyValue(qjsLeft, propAtom.name,
                val, "JS_PROP_C_W_E | JS_PROP_THROW"));
            writeQJSTrailingSemicolon();
            writeQJSLine();

            qjsRight.needfree = false;
        }

        function emitPropertyAssignment(node: PropertyAssignment) {
            emit(node.name);
            writePunctuation(":");
            writeSpace();
            // This is to ensure that we emit comment in the following case:
            //      For example:
            //          obj = {
            //              id: /*comment1*/ ()=>void
            //          }
            // "comment1" is not considered to be leading comment for node.initializer
            // but rather a trailing comment on the previous node.
            const initializer = node.initializer;
            if ((getEmitFlags(initializer) & EmitFlags.NoLeadingComments) === 0) {
                const commentRange = getCommentRange(initializer);
                emitTrailingCommentsOfPosition(commentRange.pos);
            }
            emitExpression(initializer, parenthesizer.parenthesizeExpressionForDisallowedComma);

            if (!!printerOptions.emitQJSCode) {
                emitQJSPropertyAssignment(node.name);
            }
        }

        function emitShorthandPropertyAssignment(node: ShorthandPropertyAssignment) {
            emit(node.name);
            if (node.objectAssignmentInitializer) {
                writeSpace();
                writePunctuation("=");
                writeSpace();
                emitExpression(node.objectAssignmentInitializer, parenthesizer.parenthesizeExpressionForDisallowedComma);
            }
        }

        function emitSpreadAssignment(node: SpreadAssignment) {
            if (node.expression) {
                emitTokenWithComment(SyntaxKind.DotDotDotToken, node.pos, writePunctuation, node);
                emitExpression(node.expression, parenthesizer.parenthesizeExpressionForDisallowedComma);
            }
        }

        //
        // Enum
        //

        function emitEnumMember(node: EnumMember) {
            emit(node.name);
            emitInitializer(node.initializer, node.name.end, node, parenthesizer.parenthesizeExpressionForDisallowedComma);
        }

        //
        // JSDoc
        //
        function emitJSDoc(node: JSDoc) {
            write("/**");
            if (node.comment) {
                const text = getTextOfJSDocComment(node.comment);
                if (text) {
                    const lines = text.split(/\r\n?|\n/g);
                    for (const line of lines) {
                        writeLine();
                        writeSpace();
                        writePunctuation("*");
                        writeSpace();
                        write(line);
                    }
                }
            }
            if (node.tags) {
                if (node.tags.length === 1 && node.tags[0].kind === SyntaxKind.JSDocTypeTag && !node.comment) {
                    writeSpace();
                    emit(node.tags[0]);
                }
                else {
                    emitList(node, node.tags, ListFormat.JSDocComment);
                }
            }
            writeSpace();
            write("*/");
        }

        function emitJSDocSimpleTypedTag(tag: JSDocTypeTag | JSDocThisTag | JSDocEnumTag | JSDocReturnTag) {
            emitJSDocTagName(tag.tagName);
            emitJSDocTypeExpression(tag.typeExpression);
            emitJSDocComment(tag.comment);
        }

        function emitJSDocSeeTag(tag: JSDocSeeTag) {
            emitJSDocTagName(tag.tagName);
            emit(tag.name);
            emitJSDocComment(tag.comment);
        }

        function emitJSDocNameReference(node: JSDocNameReference) {
            writeSpace();
            writePunctuation("{");
            emit(node.name);
            writePunctuation("}");
        }

        function emitJSDocHeritageTag(tag: JSDocImplementsTag | JSDocAugmentsTag) {
            emitJSDocTagName(tag.tagName);
            writeSpace();
            writePunctuation("{");
            emit(tag.class);
            writePunctuation("}");
            emitJSDocComment(tag.comment);
        }

        function emitJSDocTemplateTag(tag: JSDocTemplateTag) {
            emitJSDocTagName(tag.tagName);
            emitJSDocTypeExpression(tag.constraint);
            writeSpace();
            emitList(tag, tag.typeParameters, ListFormat.CommaListElements);
            emitJSDocComment(tag.comment);
        }

        function emitJSDocTypedefTag(tag: JSDocTypedefTag) {
            emitJSDocTagName(tag.tagName);
            if (tag.typeExpression) {
                if (tag.typeExpression.kind === SyntaxKind.JSDocTypeExpression) {
                    emitJSDocTypeExpression(tag.typeExpression);
                }
                else {
                    writeSpace();
                    writePunctuation("{");
                    write("Object");
                    if (tag.typeExpression.isArrayType) {
                        writePunctuation("[");
                        writePunctuation("]");
                    }
                    writePunctuation("}");
                }
            }
            if (tag.fullName) {
                writeSpace();
                emit(tag.fullName);
            }
            emitJSDocComment(tag.comment);
            if (tag.typeExpression && tag.typeExpression.kind === SyntaxKind.JSDocTypeLiteral) {
                emitJSDocTypeLiteral(tag.typeExpression);
            }
        }

        function emitJSDocCallbackTag(tag: JSDocCallbackTag) {
            emitJSDocTagName(tag.tagName);
            if (tag.name) {
                writeSpace();
                emit(tag.name);
            }
            emitJSDocComment(tag.comment);
            emitJSDocSignature(tag.typeExpression);
        }

        function emitJSDocSimpleTag(tag: JSDocTag) {
            emitJSDocTagName(tag.tagName);
            emitJSDocComment(tag.comment);
        }

        function emitJSDocTypeLiteral(lit: JSDocTypeLiteral) {
            emitList(lit, factory.createNodeArray(lit.jsDocPropertyTags), ListFormat.JSDocComment);
        }

        function emitJSDocSignature(sig: JSDocSignature) {
            if (sig.typeParameters) {
                emitList(sig, factory.createNodeArray(sig.typeParameters), ListFormat.JSDocComment);
            }
            if (sig.parameters) {
                emitList(sig, factory.createNodeArray(sig.parameters), ListFormat.JSDocComment);
            }
            if (sig.type) {
                writeLine();
                writeSpace();
                writePunctuation("*");
                writeSpace();
                emit(sig.type);
            }
        }

        function emitJSDocPropertyLikeTag(param: JSDocPropertyLikeTag) {
            emitJSDocTagName(param.tagName);
            emitJSDocTypeExpression(param.typeExpression);
            writeSpace();
            if (param.isBracketed) {
                writePunctuation("[");
            }
            emit(param.name);
            if (param.isBracketed) {
                writePunctuation("]");
            }
            emitJSDocComment(param.comment);
        }

        function emitJSDocTagName(tagName: Identifier) {
            writePunctuation("@");
            emit(tagName);
        }

        function emitJSDocComment(comment: string | NodeArray<JSDocComment> | undefined) {
            const text = getTextOfJSDocComment(comment);
            if (text) {
                writeSpace();
                write(text);
            }
        }

        function emitJSDocTypeExpression(typeExpression: JSDocTypeExpression | undefined) {
            if (typeExpression) {
                writeSpace();
                writePunctuation("{");
                emit(typeExpression.type);
                writePunctuation("}");
            }
        }

        //
        // Top-level nodes
        //

        function emitSourceFile(node: SourceFile) {
            writeLine();
            const statements = node.statements;
            if (emitBodyWithDetachedComments) {
                // Emit detached comment if there are no prologue directives or if the first node is synthesized.
                // The synthesized node will have no leading comment so some comments may be missed.
                const shouldEmitDetachedComment = statements.length === 0 ||
                    !isPrologueDirective(statements[0]) ||
                    nodeIsSynthesized(statements[0]);
                if (shouldEmitDetachedComment) {
                    emitBodyWithDetachedComments(node, statements, emitSourceFileWorker);
                    return;
                }
            }
            emitSourceFileWorker(node);
        }

        function emitSyntheticTripleSlashReferencesIfNeeded(node: Bundle) {
            emitTripleSlashDirectives(!!node.hasNoDefaultLib, node.syntheticFileReferences || [], node.syntheticTypeReferences || [], node.syntheticLibReferences || []);
            for (const prepend of node.prepends) {
                if (isUnparsedSource(prepend) && prepend.syntheticReferences) {
                    for (const ref of prepend.syntheticReferences) {
                        emit(ref);
                        writeLine();
                    }
                }
            }
        }

        function emitTripleSlashDirectivesIfNeeded(node: SourceFile) {
            if (node.isDeclarationFile) emitTripleSlashDirectives(node.hasNoDefaultLib, node.referencedFiles, node.typeReferenceDirectives, node.libReferenceDirectives);
        }

        function emitTripleSlashDirectives(hasNoDefaultLib: boolean, files: readonly FileReference[], types: readonly FileReference[], libs: readonly FileReference[]) {
            if (hasNoDefaultLib) {
                const pos = writer.getTextPos();
                writeComment(`/// <reference no-default-lib="true"/>`);
                if (bundleFileInfo) bundleFileInfo.sections.push({ pos, end: writer.getTextPos(), kind: BundleFileSectionKind.NoDefaultLib });
                writeLine();
            }
            if (currentSourceFile && currentSourceFile.moduleName) {
                writeComment(`/// <amd-module name="${currentSourceFile.moduleName}" />`);
                writeLine();
            }
            if (currentSourceFile && currentSourceFile.amdDependencies) {
                for (const dep of currentSourceFile.amdDependencies) {
                    if (dep.name) {
                        writeComment(`/// <amd-dependency name="${dep.name}" path="${dep.path}" />`);
                    }
                    else {
                        writeComment(`/// <amd-dependency path="${dep.path}" />`);
                    }
                    writeLine();
                }
            }
            for (const directive of files) {
                const pos = writer.getTextPos();
                writeComment(`/// <reference path="${directive.fileName}" />`);
                if (bundleFileInfo) bundleFileInfo.sections.push({ pos, end: writer.getTextPos(), kind: BundleFileSectionKind.Reference, data: directive.fileName });
                writeLine();
            }
            for (const directive of types) {
                const pos = writer.getTextPos();
                const resolutionMode = directive.resolutionMode && directive.resolutionMode !== currentSourceFile?.impliedNodeFormat
                    ? `resolution-mode="${directive.resolutionMode === ModuleKind.ESNext ? "import" : "require"}"`
                    : "";
                writeComment(`/// <reference types="${directive.fileName}" ${resolutionMode}/>`);
                if (bundleFileInfo) bundleFileInfo.sections.push({ pos, end: writer.getTextPos(), kind: !directive.resolutionMode ? BundleFileSectionKind.Type : directive.resolutionMode === ModuleKind.ESNext ? BundleFileSectionKind.TypeResolutionModeImport : BundleFileSectionKind.TypeResolutionModeRequire, data: directive.fileName });
                writeLine();
            }
            for (const directive of libs) {
                const pos = writer.getTextPos();
                writeComment(`/// <reference lib="${directive.fileName}" />`);
                if (bundleFileInfo) bundleFileInfo.sections.push({ pos, end: writer.getTextPos(), kind: BundleFileSectionKind.Lib, data: directive.fileName });
                writeLine();
            }
        }

        // type checker will guarantee the name is unique.
        // so that I just simply add a type prefix to var name.
        // but note: new name might violate var naming spec(length) in C.
        function generateQJSVarName(type: QJSCType, name: string, isRef = false): string {
            const prefix = qjsTypeInfo[type].prefix;
            const baseName = prefix + name;
            return isRef ? "*" + baseName : baseName;
        }

        function isUniqueQJSName(name: string): boolean {
            return !qjsGeneratedNames.has(name)
                && !(qjsReservedScopeNames && qjsReservedScopeNames.has(name));
        }

        function makeQJSUniqueName(baseName: string, checkFn: (name: string) => boolean = isUniqueQJSName, optimistic?: boolean, scoped?: boolean): string {
            if (optimistic) {
                if (checkFn(baseName)) {
                    if (scoped) {
                        qjsReserveNameInNestedScopes(baseName);
                    }
                    else {
                        qjsGeneratedNames.add(baseName);
                    }
                    return baseName;
                }
            }
            // Find the first unique 'name_n', where n is a positive number
            if (baseName.charCodeAt(baseName.length - 1) !== CharacterCodes._) {
                baseName += "_";
            }
            let i = 1;
            while (true) {
                const generatedName = baseName + i;
                if (checkFn(generatedName)) {
                    if (scoped) {
                        qjsReserveNameInNestedScopes(generatedName);
                    }
                    else {
                        qjsGeneratedNames.add(generatedName);
                    }
                    return generatedName;
                }
                i++;
            }
        }

        function generateQJSTempVarName(type: QJSCType): string {
            const name = generateQJSVarName(type, QJSReserved.QJSTempVarName);
            return makeQJSUniqueName(name, isUniqueQJSName, true, true);
        }

        function generateQJSNewAtom(param: string): string {
            const func = QJSFunction.JS_NewAtom + "(" + QJSReserved.DefaultCtx + ", \"" + param + "\")";
            return func;
        }

        function generateQJSNewCFunction(name: string, paramCount: number): string {
            const cfunc_name = QJSReserved.FuncPrefix + name;
            const func = QJSFunction.JS_NewCFunction2 + "(" + QJSReserved.DefaultCtx + ", " +
                        cfunc_name + ", \"" + name + "\", "+ paramCount + ")";
            return func;
        }

        function generateQJSNewCFunction2(name: string, paramCount: number, cproto: string, magic: number): string {
            const cfunc_name = QJSReserved.FuncPrefix + name;
            const func = QJSFunction.JS_NewCFunction2 + "(" + QJSReserved.DefaultCtx + ", " +
                        cfunc_name + ", \"" + name + "\", "+ paramCount + ", " + cproto + ", " + magic + ")";
            return func;
        }

        function generateQJSNewObject(): string {
            return QJSFunction.JS_NewObject + "(" + QJSReserved.DefaultCtx + ")";
        }

        function generateQJSNewArray(): string {
            return QJSFunction.JS_NewArray + "(" + QJSReserved.DefaultCtx + ")";
        }

        function generateQJSNewString(text: string): string {
            if (text.length < 64) {
                return QJSFunction.JS_NewString + "(" + QJSReserved.DefaultCtx + ", " + text + ")";
            }
            else {
                Debug.fail("qjs emitter: too long string, cannot put as argument directly.");
            }
        }

        function generateQJSConcatString(left: string, right: string): string {
            left = generateQJSDupValue(left);
            right = generateQJSDupValue(right);
            return QJSFunction.JS_ConcatString + "(" + QJSReserved.DefaultCtx + ", " + left + ", " + right +")";
        }

        function generateQJSFreeAtom(atom: QJSVar): string {
            const func = QJSFunction.JS_FreeAtom + "(" + QJSReserved.DefaultCtx + ", " + atom.name + ")";
            return func;
        }

        function generateQJSFreeValue(val: QJSVar): string {
            const func = QJSFunction.JS_FreeValue + "(" + QJSReserved.DefaultCtx + ", " + val.name + ")";
            return func;
        }

        function generateQJSDefineGlobalVar(atom: QJSVar): string {
            const flags = "DEFINE_GLOBAL_LEX_VAR | JS_PROP_WRITABLE";
            const func = QJSFunction.JS_DefineGlobalVar+ "(" +
                        QJSReserved.DefaultCtx + ", " + atom.name + ", " + flags + ")";
            return func;
        }

        function generateQJSDefineGlobalFunction(prop: string, func: QJSVar ,flags: string): string {
            const code = QJSFunction.JS_DefineGlobalFunction+ "(" +
                        QJSReserved.DefaultCtx + ", " + prop + ", " + func.name + ", " + flags + ")";
            return code;
        }

        function generateQJSDefinePropertyValue(obj: QJSVar , prop: string, val: QJSVar | string, flags: string): string {
            let valName = "";
            if (typeof val === "string") {
                valName = val;
            }
            else {
                valName = val.name;
            }
            const func = QJSFunction.JS_DefinePropertyValue+ "(" +
                        QJSReserved.DefaultCtx + ", " + obj.name + ", " + prop + ", " + valName + ", " + flags + ")";
            return func;
        }

        function generateQJSSetProperty(obj: QJSVar | string, prop: string, val: QJSVar | string, flags = "JS_PROP_THROW"): string {
            let objName = "";
            if (typeof obj === "string") {
                objName = obj;
            }
            else {
                objName = obj.name;
            }

            let valName = "";
            if (typeof val === "string") {
                valName = val;
            }
            else {
                valName = val.name;
            }
            const func = QJSFunction.JS_SetPropertyInternal+ "(" +
                        QJSReserved.DefaultCtx + ", " + objName + ", " + prop + ", " + valName + ", " + flags + ")";
            return func;
        }

        function generateQJSSetPropertyUint32(obj: QJSVar | string, index: string, val: QJSVar | string): string {
            let objName = "";
            if (typeof obj === "string") {
                objName = obj;
            }
            else {
                objName = obj.name;
            }

            let valName = "";
            if (typeof val === "string") {
                valName = val;
            }
            else {
                valName = val.name;
            }
            const func = QJSFunction.JS_SetPropertyUint32+ "(" +
                        QJSReserved.DefaultCtx + ", " + objName + ", " + index + ", " + valName + ")";
            return func;
        }

        function generateQJSGetElementValue(obj: QJSVar | string, index: QJSVar): string {
            let objName = "";
            if (typeof obj === "string") {
                objName = obj;
            }
            else {
                objName = obj.name;
            }

            let indexName = index.name;
            if (index.type !== QJSCType.JSValue) {
                indexName = generateQJSMKVal(index);
            }

            const func = QJSFunction.JS_GetElementValue+ "(" +
                        QJSReserved.DefaultCtx + ", " + objName + ", " + indexName + ")";

            index.needfree = false;
            return func;
        }
/*
        function generateQJSGetPropertyUint32(obj: QJSVar | string, index: string): string {
            let objName = "";
            if (typeof obj === "string") {
                objName = obj;
            }
            else {
                objName = obj.name;
            }

            const func = QJSFunction.JS_GetPropertyUint32+ "(" +
                        QJSReserved.DefaultCtx + ", " + objName + ", " + index + ")";
            return func;
        }
*/
        function generateQJSSetPropertyInt64(obj: QJSVar | string, index: QJSVar, val: QJSVar | string): string {
            let objName = "";
            if (typeof obj === "string") {
                objName = obj;
            }
            else {
                objName = obj.name;
            }

            let valName = "";
            if (typeof val === "string") {
                valName = val;
            }
            else {
                valName = val.name;
            }

            let indexName = index.name
            if (index.type === QJSCType.JSValue) {
                indexName = generateQJSJSValueGetInt(index);
            }
            const func = QJSFunction.JS_SetPropertyInt64+ "(" +
                        QJSReserved.DefaultCtx + ", " + objName + ", " + indexName + ", " + valName + ")";
            return func;
        }

        function generateQJSSetPropertyInt(obj: QJSVar | string, index: QJSVar, val: QJSVar | string): string {
            if (index.value && +index.value >= (0xffffffff)) {
                return generateQJSSetPropertyInt64(obj, index, val);
            }
            else {
                return generateQJSSetPropertyUint32(obj, index.name, val);
            }
        }

        function generateQJSGetProperty(obj: QJSVar | string, prop: string, flags = "0"): string {
            let objName = "";
            if (typeof obj === "string") {
                objName = obj;
            }
            else {
                objName = obj.name;
            }
            const func = QJSFunction.JS_GetPropertyInternal+ "(" +
                        QJSReserved.DefaultCtx + ", " + objName + ", " + prop + ", " + objName + ", " + flags + ")";
            return func;
        }

        function generateQJSGetPropertyValue(obj: QJSVar | string, prop: QJSVar): string {
            let objName = "";
            if (typeof obj === "string") {
                objName = obj;
            }
            else {
                objName = obj.name;
            }

            let propName = prop.name;
            if (prop.type !== QJSCType.JSValue) {
                propName = generateQJSMKVal(prop);
            }
            const func = QJSFunction.JS_GetPropertyValue+ "(" +
                        QJSReserved.DefaultCtx + ", " + objName + ", " + propName + ")";

            prop.needfree = false;
            return func;
        }

        function generateQJSAddModuleExportByAtom(exportName: QJSVar): string {
            return QJSFunction.JS_AddModuleExportByAtom + "(" +
            QJSReserved.DefaultCtx + ", module, " + exportName.name + ")";
        }

        function generateQJSAddModuleImportByAtom(exportName: QJSVar, localIndex: number): string {
            return QJSFunction.JS_AddModuleImportByAtom + "(" +
            QJSReserved.DefaultCtx + ", module, " + exportName.name + ", " + localIndex + ")";
        }

        function generateQJSAddReqModule(moduleName: QJSVar): string {
            return QJSFunction.JS_AddReqModule + "(" +
            QJSReserved.DefaultCtx + ", module, " + moduleName.name + ")";
        }

        function generateQJSNewBool(qjsVar: QJSVar): string {
            const val = (qjsVar.value && qjsVar.jstype === QJSJSType.NumLiteral) ? qjsVar.value : qjsVar.name;
            const func = QJSFunction.JS_MKVAL + "(" + QJSReserved.JS_TAG_BOOL + ", " + val + ")";
            return func;
        }

        function generateQJSNewInt32(qjsVar: QJSVar): string {
            const val = (qjsVar.value && qjsVar.jstype === QJSJSType.NumLiteral) ? qjsVar.value : qjsVar.name;
            const func = QJSFunction.JS_MKVAL + "(" + QJSReserved.JS_TAG_INT + ", " + val + ")";
            return func;
        }


        function generateQJSNewFloat64(qjsVar: QJSVar): string {
            const val = (qjsVar.value && qjsVar.jstype === QJSJSType.NumLiteral) ? qjsVar.value : qjsVar.name;
            const func = QJSFunction.JS_NewFloat64 + "(" + QJSReserved.DefaultCtx + ", " + val + ")";
            return func;
        }

        function generateQJSGetGlobalVar(atom: QJSVar): string {
            return QJSFunction.JS_GetGlobalVar + "(" +
                                    QJSReserved.DefaultCtx + ", " + atom.name + ", false)";
        }

        function generateQJSSetGlobalVar(atom: QJSVar, val: QJSVar | string, flags = "2"): string {
            let valName = "";
            if (typeof val !== "string") {
                valName = val.name;
            }
            else {
                valName = val;
            }
            return QJSFunction.JS_SetGlobalVar + "(" +
                                    QJSReserved.DefaultCtx + ", " + atom.name + ", " +
                                    valName + ", " + flags + ")";
        }

        function generateQJSSetAndGetModuleExportVarRefByIndex(index: number, atomName: QJSVar, val: QJSVar) {
            return QJSFunction.JS_SetAndGetModuleExportVarRefByIndex + "(" +
                                    QJSReserved.DefaultCtx + ", m, " + index + ", " +
                                    atomName.name + ", " + val.name + ")";
        }

        function generateQJSGetVarRefFromModuleExport(exportIndex: number) {
            return QJSFunction.JS_GetVarRefFromModuleExport + "(" +
            QJSReserved.DefaultCtx + ", m, " + exportIndex + ")";
        }

        function generateQJSCreateModuleVar(islexical: string): string {
            return QJSFunction.JS_CreateModuleVar + "(ctx, " + islexical + ")";
        }

        function generateQJSMKVal(qjsVal: QJSVar) {
            switch (qjsVal.type) {
                case QJSCType.IntLiteral:
                case QJSCType.Int:
                    return generateQJSNewInt32(qjsVal);
                    break;
                case QJSCType.FloatLiteral:
                case QJSCType.Double:
                    return generateQJSNewFloat64(qjsVal);
                    break;
                case QJSCType.Bool:
                    return generateQJSNewBool(qjsVal);
                    break;
                case QJSCType.JSValue:
                    return qjsVal.name;
                    break;
                default:
                    Debug.fail("qjs emitter: unsupported type in generateQJSMKVal");
                    break;
            }
        }

        function generateQJSSetTempValue(target: QJSVar, val: QJSVar): string {
            Debug.assert(val.type !== QJSCType.JSValue && val.type !== QJSCType.JSAtom);
            let func = "";
            const mkval = generateQJSMKVal(val);
            if (target.jstype < QJSJSType.RefType) {
                func = target.name + " = " + mkval;
            }
            else {
                const targetName = target.name.charAt(0) === "*" ? target.name.substring(1) : "&" + target.name;
                func = QJSFunction.JS_SetValue + "(" +
                                QJSReserved.DefaultCtx + ", " + targetName + ", " +
                                mkval + ")";
            }

            /*
            if (val.type === QJSCType.Int) {
                target.jstype = QJSJSType.Int32;
            }
            else if (val.type === QJSCType.Double) {
                target.jstype = QJSJSType.Float64;
            }
            else {
                Debug.fail("qjs emitter: unsupported type in generateQJSSetTempValue");
            }
            */

            target.jstype = val.jstype;
            target.value = val.value;
            if (target.jsvar) {
                target.jsvar.type = target.jstype;
                target.jsvar.value = target.value;
                target.jsvar.inited = true;
                target.jsvar.needsync = true;

                //const atomVar = getQJSVarByType(target.jsvar, QJSCType.JSAtom);
                //if (atomVar) {
                //    target.jsvar.writeBack = true;
                //}
            }

            val.needfree = false;

            return func;
        }

        function generateQJSSetValue(target: QJSVar, val: QJSVar): string {
            let func = "";
            if (target.jstype < QJSJSType.RefType) {
                func = target.name + " = " + val.name;
            }
            else {
                const targetName = target.name.charAt(0) === "*" ? target.name.substring(1) : "&" + target.name;
                func = QJSFunction.JS_SetValue + "(" +
                                QJSReserved.DefaultCtx + ", " + targetName + ", " +
                                val.name + ")";
            }

            target.jstype = val.jstype;
            target.value = val.value;
            if (target.jsvar) {
                target.jsvar.type = val.jstype;
                target.jsvar.value = target.value;
                target.jsvar.inited = true;
                target.jsvar.needsync = true;

                //const atomVar = getQJSVarByType(target.jsvar, QJSCType.JSAtom);
                //if (atomVar) {
                //    target.jsvar.writeBack = true;
                //}
            }

            val.needfree = false;

            return func;
        }

        function generateQJSDupValue(val: QJSVar | string): string {
            if (typeof val !== "string") {
                const func = QJSFunction.JS_DupValue + "(" +
                                QJSReserved.DefaultCtx + ", " +
                                val.name + ")";
                return func;
            }
            else {
                const func = QJSFunction.JS_DupValue + "(" +
                                QJSReserved.DefaultCtx + ", " +
                                val + ")";
                return func;
            }
        }
/*
        function generateQJSJSValueGetTag(qjsVar: QJSVar | string): string {
            if (typeof qjsVar !== "string") {
                return QJSFunction.JS_VALUE_GET_TAG + "(" +
                    qjsVar.name + ")";
            }
            else {
                return QJSFunction.JS_VALUE_GET_TAG + "(" +
                    qjsVar + ")";
            }
        }
*/
        function generateQJSJSToBool(val: QJSVar): string {
            return QJSFunction.JS_ToBool + "(ctx, " +
                    val.name + ")";
        }

        function generateQJSJSValueGetBool(val: QJSVar | string): string {
            if (typeof val !== "string") {
                return QJSFunction.JS_VALUE_GET_BOOL + "(" +
                    val.name + ")";
            }
            else {
                return QJSFunction.JS_VALUE_GET_BOOL + "(" +
                    val + ")";
            }
        }

        function generateQJSJSValueGetInt(val: QJSVar | string): string {
            if (typeof val !== "string") {
                return QJSFunction.JS_VALUE_GET_INT + "(" +
                    val.name + ")";
            }
            else {
                return QJSFunction.JS_VALUE_GET_INT + "(" +
                    val + ")";
            }
        }

        function generateQJSJSValueGetFloat64(val: QJSVar | string): string {
            if (typeof val !== "string") {
                return QJSFunction.JS_VALUE_GET_FLOAT64 + "(" +
                    val.name + ")";
            }
            else {
                return QJSFunction.JS_VALUE_GET_FLOAT64 + "(" +
                    val + ")";
            }
        }

        function generateQJSJSDefineClass(ctor: QJSVar | string, atom: QJSVar): string {
            let ctor_name = "";
            if (typeof ctor !== "string") {
                ctor_name = ctor.name;
            }
            else {
                ctor_name = ctor;
            }
            return QJSFunction.JS_DefineClass + "(ctx, " + ctor_name + ", " +
                atom.name + ", NULL, 0, sf, FALSE)";
        }

/*
        function generateQJSAssignNumber(qjsVar: QJSVar, qjsVal: QJSVar): string {
                return qjsVar.name + " = " + qjsVal.name;
        }
*/
        function generateQJSMemberNames(node: Node | undefined) {
            if (!node) {
                return;
            }

            const jsName = getTextOfNode((node as NamedDeclaration).name!, false);
            const varAtomName = qjsTypeInfo[QJSCType.JSAtom].prefix + jsName;//qjsAtomIndex.toString();
            const qjsAtomVar = qjsNewVar(undefined, QJSCType.JSAtom, varAtomName, true, true);
            qjsAtomMap.set(jsName, qjsAtomVar);
            //qjsAtomIndex ++;
        }
/*
        function generateQJSGlobalSymbol(symbol: string): string {
            return QJSReserved.DefaultObject + "|" + symbol;
        }
*/
        function generateQJSPropSymbol(obj: QJSVar, symbol: string): string {
            return obj.name + "|" + symbol;
        }

        function generateQJSUpdateFrameBuf1(argCount: string, varCount: string): string {
            return QJSFunction.JS_UPDATE_SF_FUNC + "(ctx, argc, argv, " + argCount + ", " + varCount + ")";
        }

        function generateQJSUpdateFrameBuf2(argCount: string, varCount: string): string  {
            return QJSFunction.JS_UPDATE_SF_MACRO + "(ctx, sf, argc, argv, " + argCount + ", " + varCount + ")";
        }

        function qjsPushVar(qjsVar: QJSVar): number {
            if (qjsVar.type === QJSCType.JSAtom) {
                return -1;
            }

            const curFrame = qjsGetCurFrame();
            const len = curFrame.vars.push(qjsVar);
            return len - 1;
        }

        function qjsNewVar(jsVar: QJSJSVar | undefined, ctype: QJSCType, varName: string, needFree = true, isGlobal = false): QJSVar {
            const qjsVar: QJSVar = {frame: ctype !== QJSCType.JSAtom? qjsGetCurFrame() : undefined,
                                    type: ctype,
                                    name: varName,
                                    value: undefined,
                                    needfree: needFree,
                                    flags: 0,
                                    jstype: jsVar ? jsVar.type : QJSJSType.Unknown,
                                    jsvar: jsVar,
                                    define: undefined,
                                    use: undefined};

            if (qjsVar.jsvar && qjsVar.jsvar.type < QJSJSType.RefType) {
                qjsVar.needfree = false;
            }

            if (qjsVar.type === QJSCType.JSAtom) {
                qjsVar.needfree = true;
            }

            if (!isGlobal) {
                qjsPushVar(qjsVar);
            }
            else {

            }

            return qjsVar;
        }

        function qjsNewJSVar(jsname: string, jstype: QJSJSType, jskind: QJSJSVarKind, qjsvar: QJSVar, frameDecl: QJSFrame | undefined = undefined): QJSJSVar {
            const jsVar: QJSJSVar = {
                name: jsname,
                index: -1,
                type: jstype,
                kind: jskind,
                outer: undefined,
                inited: false,
                needsync: false,
                cvar: qjsvar,
                uses: [],
                frame: frameDecl ? frameDecl : qjsGetCurFrame(),
                value: undefined,
                flags: 0,
            };


            qjsvar.jsvar = jsVar;
            qjsvar.jstype = jsVar.type;
            if (jsVar.type < QJSJSType.RefType) {
                qjsvar.needfree = false;
            }
            else {
                qjsvar.needfree = true;
            }

            if (!frameDecl) {
                frameDecl = qjsGetCurFrame();
            }
            const qjsJSVarMap = frameDecl.jsvarmap;
            //qjsJSVarMap.set(generateQJSGlobalSymbol(qjsAtomVar.name), jsVar);
            //if (jskind === QJSJSVarKind.GlobalVar) {
            qjsJSVarMap.set(jsname, jsVar);
            //}
            return jsVar;
        }

        /*
        function qjsPopVar(): {local: QJSVar | undefined, code: string} {
            if (qjsContainerStack.length === 0) {
                return {local: undefined, code: ""};
            }

            const qjsVar = qjsContainerStack.pop()!;
            qjsJS2CVarMap.delete(qjsVar.varname);
            let freeCode = "";
            if (qjsVar.type === QJSCType.JSValue) {
                freeCode = generateQJSFreeValue(qjsVar.varname);
            }
            else if (qjsVar.type === QJSCType.JSAtom) {
                freeCode = generateQJSFreeAtom(qjsVar.varname);
            }
            return {local: qjsVar, code: freeCode};
        }
        */

        function emitQJSNewAtom(qjsVar: QJSVar, param: string) {
            writeQJSKeyword(qjsVar.name);
            writeQJSSpace();
            writeQJSOperator("=");
            writeQJSSpace();
            writeQJSBase(generateQJSNewAtom(param));
            writeQJSTrailingSemicolon();
            writeQJSLine();
            qjsVar.needfree = true;
        }

        function emitQJSGlobalVarDef(symbol: Symbol) {
            const valDecl = symbol.valueDeclaration as VariableDeclaration;
            const jsName = getTextOfNode(valDecl.name, false);
            const type = checker!.getTypeOfSymbol(symbol);

            let jsType = QJSJSType.Unknown;
            if (type.flags & TypeFlags.Number) {
                jsType = QJSJSType.Float64;
            }

            const varAtomName = qjsTypeInfo[QJSCType.JSAtom].prefix + jsName;//qjsAtomIndex.toString();
            const qjsAtomVar = qjsNewVar(undefined, QJSCType.JSAtom, varAtomName, true, true);
            const varName = qjsTypeInfo[QJSCType.JSValue].prefix + jsName;
            const qjsVar = qjsNewVar(undefined, QJSCType.JSValue, varName);
            const jsVar = qjsNewJSVar(jsName, jsType, QJSJSVarKind.GlobalVar, qjsVar);

            qjsAtomMap.set(jsVar.name, qjsAtomVar);

            writeQJSBase(generateQJSDefineGlobalVar(qjsAtomVar));
            writeQJSTrailingSemicolon();
            writeQJSLine();

            emitQJSDeclareQJSVar(qjsVar);
        }

        function emitQJSLocalVarInit(ctype: QJSCType, index: number, varName: string): string {
            writeQJSKeyword(qjsTypeInfo[ctype].type);
            writeQJSSpace();
            writeQJSKeyword(varName);
            writeQJSSpace();
            writeQJSOperator("=");
            writeQJSSpace();
            writeQJSBase("&sf->var_buf[" + index +"]");
            //writeQJSKeyword(initVal);
            writeQJSTrailingSemicolon();
            writeQJSLine();
            return varName;
        }

        function emitQJSDeclareLocalNumberVar(localIndex: number, tagName: string | undefined, jsName: string) {
            (tagName);
            if (qjsConfig.emitUnboxNumVar) {
            /*
                const jsVar: QJSJSVar = {
                    name: jsName,
                    type: QJSJSType.Float64,
                    kind: QJSJSVarKind.LocalVar,
                    cvar: qjsIntVar,
                };
                let ctype = QJSCType.Tag;
                let initVal: string = QJSReserved.JS_TAG_INT;
                if (tagName) {
                    initVal = generateQJSJSValueGetTag(tagName);
                }

                const tagVarName = emitQJSLocalVarInit(ctype, initVal, jsName);
                const qjsTagVar = qjsNewVar(jsVar, ctype, tagVarName, false);


                ctype = QJSCType.Int;
                initVal = QJSReserved.IntInitVal;
                const intVarName = emitQJSLocalVarInit(ctype, initVal, jsName);

                const qjsIntVar = qjsNewVar(jsVar, ctype, intVarName, false);


                ctype = QJSCType.Double;
                initVal = QJSReserved.DoubleInitVal;

                const doubleVarName = emitQJSLocalVarInit(ctype, initVal, jsName);
                writeQJSLine(2);

                const qjsDoubleVar = qjsNewVar(jsVar, ctype, doubleVarName, false);
            */
            }
            else {
                //const initVal = QJSReserved.JSUninitialized;

                const varName = generateQJSVarName(QJSCType.JSValue, jsName, true);

                const qjsVar = qjsNewVar(undefined, QJSCType.JSValue, varName);
                const jsvar = qjsNewJSVar(jsName, QJSJSType.Float64, QJSJSVarKind.LocalVar, qjsVar);
                jsvar.index = localIndex;

                emitQJSLocalVarInit(QJSCType.JSValue, localIndex, varName);

            }
        }

        function emitQJSLocalVarDef(localIndex: number, symbol: Symbol) {
            const valDecl = symbol.valueDeclaration as VariableDeclaration;
            const jsName = getTextOfNode(valDecl.name, false);
            const type = checker!.getTypeOfSymbol(symbol);
            const ctype = QJSCType.JSValue;
            //const initVal = QJSReserved.JSUninitialized;
            if (type.flags & TypeFlags.Number) {
                emitQJSDeclareLocalNumberVar(localIndex, undefined, jsName);
            }
            else {
                const varName = generateQJSVarName(QJSCType.JSValue, jsName, true);

                const qjsVar = qjsNewVar(undefined, QJSCType.JSValue, varName, true);
                const jsvar = qjsNewJSVar(jsName, QJSJSType.RefType, QJSJSVarKind.LocalVar, qjsVar);
                jsvar.index = localIndex;

                emitQJSLocalVarInit(ctype, localIndex, varName);
            }
        }

        function emitQJSSetModuleExportByIndex(index: number, atomName: QJSVar, val: QJSVar) {
            writeQJSBase(generateQJSSetAndGetModuleExportVarRefByIndex(index, atomName, val));
            writeQJSTrailingSemicolon();
            writeQJSLine();

            val.needfree = false;
        }

        function emitQJSGetVarRefFromModuleExport(exportIndex: number) {
            writeQJSBase(generateQJSGetVarRefFromModuleExport(exportIndex));
            writeQJSTrailingSemicolon();
            writeQJSLine();
        }

        function emitQJSModuleVarDef(localIndex: number, importOrExportIndex: number, symbol: Symbol) {
            let decl: Declaration;
            let isExport = false;
            let isImport = false;
            if (symbol.valueDeclaration) {
                decl = symbol.valueDeclaration;
            }
            else if (symbol.exportSymbol &&
                symbol.exportSymbol.valueDeclaration) {
                    decl = symbol.exportSymbol.valueDeclaration;
                    isExport = true;
            }
            else {
                isImport = true;
                decl = symbol.declarations![0];
            }

            let type: Type;
            if (!isExport) {
                type = checker!.getTypeOfSymbol(symbol);
            }
            else {
                type = checker!.getTypeOfSymbol(symbol.exportSymbol!);
            }

            let jsName = "";
            if (decl.kind === SyntaxKind.VariableDeclaration) {
                jsName = getTextOfNode((decl as VariableDeclaration).name, false);
            }
            else if (decl.kind === SyntaxKind.ImportSpecifier) {
                jsName = getTextOfNode((decl as ImportSpecifier).name, false);
            }
            else {
                Debug.fail("qjs emitter: unsupported type now");
            }

            const varName = generateQJSVarName(QJSCType.JSValue, jsName, true);

            const qjsVar = qjsNewVar(undefined, QJSCType.JSValue, varName, true);
            const jsvar = qjsNewJSVar(jsName, QJSJSType.RefType, QJSJSVarKind.ModuleVar, qjsVar);

            if (type.flags & TypeFlags.Number ||
                type.flags & TypeFlags.Boolean) {
                qjsVar.needfree = false;
            }

            let isLexical = false;
            if (!isImport) {
                if (isLet(decl)) {
                    isLexical = true;
                }
            }

            if (isImport) {
                //writeQJSBase("var_refs[" + localIndex + "]");
                //writeQJSSpace();
                //writeQJSPunctuation("=");
                //writeQJSSpace();
                ////writeQJSBase(generateQJSCreateModuleVar(isLexical ? "true" : "false"));
                //writeQJSTrailingSemicolon();
                //writeQJSLine();
            }
            else if (isExport) {
                writeQJSBase("var_refs[" + localIndex + "]");
                writeQJSSpace();
                writeQJSPunctuation("=");
                writeQJSSpace();
                emitQJSGetVarRefFromModuleExport(importOrExportIndex);
            }
            else {
                writeQJSBase("var_refs[" + localIndex + "]");
                writeQJSSpace();
                writeQJSPunctuation("=");
                writeQJSSpace();
                writeQJSBase(generateQJSCreateModuleVar(isLexical ? "true" : "false"));
                writeQJSTrailingSemicolon();
                writeQJSLine();
            }

            jsvar.index = localIndex;

            writeQJSKeyword(qjsTypeInfo[QJSCType.JSValue].type);
            writeQJSSpace();
            writeQJSKeyword(varName);
            writeQJSSpace();
            writeQJSPunctuation("=");
            writeQJSSpace();
            writeQJSBase("var_refs[" + localIndex + "]->pvalue");
            writeQJSTrailingSemicolon();
            writeQJSLine();

            if (!isImport) {
                writeQJSKeyword(varName);
                writeQJSSpace();
                writeQJSPunctuation("=");
                writeQJSSpace();
                writeQJSBase(isLexical ? QJSReserved.JSUninitialized : QJSReserved.JSUndefined);
                writeQJSTrailingSemicolon();
                writeQJSLine();
            }
        }
/*
        function emitQJSDupValue(qjsVar: QJSVar, val: QJSVar) {
            writeQJSKeyword(qjsVar.name);
            writeQJSSpace();
            writeQJSOperator("=");
            writeQJSSpace();
            writeQJSBase(generateQJSDupValue(val));
            writeQJSTrailingSemicolon();
            writeQJSLine();
        }

        function emitQJSGetNumberValue(qjVar: QJSVar) {

        }
*/
        function emitQJSDeclareArgNumberVar(index: number, tagName: string, jsName: string) {
            if (qjsConfig.emitUnboxNumVar) {
            /*
                const jsVar: QJSJSVar = {name: jsName, type: QJSJSType.Float64, kind: QJSJSVarKind.Arg, cvars: []};
                let ctype = QJSCType.Tag;
                let initVal: string = QJSReserved.JS_TAG_INT;
                if (tagName) {
                    initVal = generateQJSJSValueGetTag(tagName);
                }

                const tagVarName = emitQJSLocalVarInit(ctype, initVal, jsName);
                const qjsTagVar = qjsNewVar(jsVar, ctype, tagVarName, false);

                ctype = QJSCType.Int;
                initVal = QJSReserved.IntInitVal;
                const intVarName = emitQJSLocalVarInit(ctype, initVal, jsName);

                const qjsIntVar = qjsNewVar(jsVar, ctype, intVarName, false);

                ctype = QJSCType.Double;
                initVal = QJSReserved.DoubleInitVal;

                const doubleVarName = emitQJSLocalVarInit(ctype, initVal, jsName);
                writeQJSLine(2);

                const qjsDoubleVar = qjsNewVar(jsVar, ctype, doubleVarName, false);
                */
            }
            else {
                const qjsArg = qjsNewVar(undefined, QJSCType.JSValue, tagName, false);
                qjsNewJSVar(tagName, QJSJSType.Float64, QJSJSVarKind.Arg, qjsArg);

                const varname = generateQJSVarName(QJSCType.JSValue, jsName, true);
                const qjsVar = qjsNewVar(undefined, QJSCType.JSValue, varname);
                const jsVar = qjsNewJSVar(jsName, QJSJSType.Float64, QJSJSVarKind.Arg, qjsVar);
                jsVar.index = index;

                writeQJSKeyword(qjsTypeInfo[QJSCType.JSValue].type);
                writeQJSSpace();
                //emitQJSDupValue(qjsVar, qjsArg);
                writeQJSKeyword(qjsVar.name);
                writeQJSSpace();
                writeQJSPunctuation("=");
                writeQJSSpace();
                writeQJSKeyword(tagName);
                writeQJSTrailingSemicolon();
                writeQJSLine();
            }
        }

        function emitQJSArgVarDef(index: number, symbol: Symbol) {
            const valDecl = symbol.valueDeclaration as VariableDeclaration;
            const name = getTextOfNode(valDecl.name);
            const type = checker!.getTypeOfSymbol(symbol);
            let argname = QJSReserved.DefaultArgv + "[" + index.toString() + "]";
            writeQJSPunctuation("(");
            writeQJSBase(argname);
            writeQJSPunctuation(")");
            writeQJSTrailingSemicolon();
            writeQJSComment("// " + name);
            writeQJSLine();

            argname = "&sf->arg_buf" + "[" + index.toString() + "]";

            if (type.flags & TypeFlags.Number) {
                emitQJSDeclareArgNumberVar(index, argname, name);
            }
            else {
                const qjsArg = qjsNewVar(undefined, QJSCType.JSValue, argname, false);
                qjsNewJSVar(argname, QJSJSType.RefType, QJSJSVarKind.Arg, qjsArg);
                qjsArg.needfree = false;

                const varname = generateQJSVarName(QJSCType.JSValue, name, true);
                const qjsVar = qjsNewVar(undefined, QJSCType.JSValue, varname);

                let jstype: QJSJSType = QJSJSType.Object;
                if (type.flags & TypeFlags.String) {
                    jstype = QJSJSType.String;
                }
                else if (type.flags & TypeFlags.Any) {
                    jstype = QJSJSType.Any;
                }
                const jsVar = qjsNewJSVar(name, jstype, QJSJSVarKind.Arg, qjsVar);
                jsVar.index = index;
                qjsVar.needfree = false; // I'm not sure if it is correct that removing arg ref count releasing within function

                writeQJSKeyword(qjsTypeInfo[QJSCType.JSValue].type);
                writeQJSSpace();
                //emitQJSDupValue(qjsVar, qjsArg);
                writeQJSKeyword(qjsVar.name);
                writeQJSSpace();
                writeQJSPunctuation("=");
                writeQJSSpace();
                //writeQJSKeyword(generateQJSDupValue(argname));
                writeQJSBase(argname);
                writeQJSTrailingSemicolon();
                writeQJSLine();
            }
        }

        function emitQJSNewCFunction(func: QJSVar, jsname: string, paramCount: number) {
            writeQJSKeyword(func.name);
            writeQJSSpace();
            writeQJSOperator("=");
            writeQJSSpace();
            writeQJSBase(generateQJSNewCFunction(jsname, paramCount));
            writeQJSTrailingSemicolon();
            writeQJSLine();

            func.needfree = true;
        }

        function emitQJSNewCFunction2(func: QJSVar, jsname: string, paramCount: number, cproto: string, magic = 0) {
            writeQJSKeyword(func.name);
            writeQJSSpace();
            writeQJSOperator("=");
            writeQJSSpace();
            writeQJSBase(generateQJSNewCFunction2(jsname, paramCount, cproto, magic));
            writeQJSTrailingSemicolon();
            writeQJSLine();

            func.needfree = true;
        }

        function emitQJSCloseVarProperty(cvName: string, index: number, prop: string, value: string) {
            writeQJSKeyword(cvName);
            writeQJSBase("[" + index + "]");
            writeQJSPunctuation(".");
            writeQJSKeyword(prop);
            writeQJSSpace();
            writeQJSPunctuation("=");
            writeQJSSpace();
            writeQJSBase(value);
            writeQJSTrailingSemicolon();
            writeQJSLine();
        }

        function emitQJSGlobalFunctionVarDef(symbol: Symbol) {
            let jsName: string;
            const funcDecl = symbol.valueDeclaration as FunctionDeclaration;

            if (funcDecl.name) {
                jsName = getTextOfNode(funcDecl.name, false);
            }
            else {
                jsName = "";
            }

            const originNode = getParseTreeNode(funcDecl) as FunctionDeclaration;
            let paramCount = 0;
            if (originNode && originNode.parameters) {
                paramCount = originNode.parameters.length;
            }

            const varName = generateQJSVarName(QJSCType.JSValue, jsName, false);
            const qjsVar = qjsNewVar(undefined, QJSCType.JSValue, varName);
            const jsVar = qjsNewJSVar(jsName, QJSJSType.Function, QJSJSVarKind.GlobalVar, qjsVar);
            jsVar.flags |= QJSJSVarFlags.isJSCFunction;

            writeQJSKeyword(qjsTypeInfo[QJSCType.JSValue].type);
            writeQJSSpace();

            emitQJSNewCFunction(qjsVar, jsName, paramCount);

            let qjsAtomVar = qjsAtomMap.get(jsName);
            if (!!jsName.length && !qjsAtomVar) {
                const atomName = qjsTypeInfo[QJSCType.JSAtom].prefix + jsName;//qjsAtomIndex.toString();
                qjsAtomVar = qjsNewVar(undefined, QJSCType.JSAtom, atomName, true, true);
                qjsAtomMap.set(jsName, qjsAtomVar);
            }

            writeQJSBase(generateQJSDefineGlobalFunction(qjsAtomVar!.name, qjsVar, "0"));
            writeQJSTrailingSemicolon();
            writeQJSLine(2);

            jsVar.inited = true;
            jsVar.needsync = false;
        }

        function emitQJSLocalFunctionVarDef(localIndex: number, symbol: Symbol, argCount: number) {
            let jsName: string;
            const funcDecl = symbol.valueDeclaration as FunctionDeclaration;

            if (funcDecl.name) {
                jsName = getTextOfNode(funcDecl.name, false);
            }
            else {
                jsName = "";
            }

            const originNode = getParseTreeNode(funcDecl) as FunctionDeclaration;
            let paramCount = 0;
            if (originNode && originNode.parameters) {
                paramCount = originNode.parameters.length;
            }

            const varName = generateQJSVarName(QJSCType.JSValue, jsName, true);
            const qjsVar = qjsNewVar(undefined, QJSCType.JSValue, varName);
            const jsVar = qjsNewJSVar(jsName, QJSJSType.Function, QJSJSVarKind.LocalVar, qjsVar);
            jsVar.flags |= QJSJSVarFlags.isJSCFunction;

            writeQJSKeyword(qjsTypeInfo[QJSCType.JSValue].type);
            writeQJSSpace();
            writeQJSKeyword(qjsVar.name);
            writeQJSSpace();
            writeQJSPunctuation("=");
            writeQJSSpace();
            writeQJSKeyword("&sf->var_buf[" + localIndex +"]");
            writeQJSTrailingSemicolon();
            writeQJSLine();

            emitQJSNewCFunction(qjsVar, jsName, paramCount);

            jsVar.inited = true;
            jsVar.needsync = false;

            if (!funcDecl.closureVars ||
                funcDecl.closureVars.length === 0) {
                return;
            }

            function emitQJSInitClosure(func: QJSVar, jsName: string, funcDecl: FunctionDeclaration) {
                const cvName = qjsTypeInfo[QJSCType.ClosureVar].prefix + jsName;
                writeQJSKeyword(qjsTypeInfo[QJSCType.ClosureVar].type);
                writeQJSSpace();
                writeQJSKeyword(cvName);
                writeQJSBase("[" + funcDecl.closureVars.length + "]");
                writeQJSTrailingSemicolon();
                writeQJSLine();

                for (let i = 0; i < funcDecl.closureVars.length; i ++) {
                    emitQJSCloseVarProperty(cvName, i, QJSReserved.CV_IS_ARG, funcDecl.closureVars[i].isArg ? "true" : "false");
                    emitQJSCloseVarProperty(cvName, i, QJSReserved.CV_IS_LOCAL, funcDecl.closureVars[i].isLocal ? "true" : "false");
                    emitQJSCloseVarProperty(cvName, i, QJSReserved.CV_IS_LEXICAL, funcDecl.closureVars[i].isLexcial ? "true" : "false");
                    emitQJSCloseVarProperty(cvName, i, QJSReserved.CV_VAR_INDEX, (funcDecl.closureVars[i].index - argCount).toString());
                    const atomName = qjsTypeInfo[QJSCType.JSAtom].prefix + funcDecl.closureVars[i].name;
                    const qjsAtomVar = qjsNewVar(undefined, QJSCType.JSAtom, atomName, true, true);
                    qjsAtomMap.set(funcDecl.closureVars[i].name, qjsAtomVar);
                    emitQJSCloseVarProperty(cvName, i, QJSReserved.CV_VAR_NAME, atomName);
                }

                writeQJSBase(QJSFunction.JS_CLOSURE_JSC + "(ctx, " + func.name + ", var_refs, " + cvName + ", " + funcDecl.closureVars.length + ", sf)");
                writeQJSTrailingSemicolon();
                writeQJSLine(2);
            }

            emitQJSInitClosure(qjsVar, jsName, funcDecl);
        }

        function emitQJSModuleFunctionVarDef(localIndex: number, importOrExportIndex: number, symbol: Symbol) {
            let jsName: string;
            let funcDecl: FunctionDeclaration;
            let isExport = false;
            let isImport = false;
            if (symbol.valueDeclaration) {
                funcDecl = symbol.valueDeclaration as FunctionDeclaration;
            }
            else if (symbol.exportSymbol &&
                symbol.exportSymbol.valueDeclaration) {
                    funcDecl = symbol.exportSymbol.valueDeclaration as FunctionDeclaration;
                    isExport = true;
            }
            else {
                isImport = true;
                return;
            }

            if (funcDecl.name) {
                jsName = getTextOfNode(funcDecl.name, false);
            }
            else {
                jsName = "";
            }

            const originNode = getParseTreeNode(funcDecl) as FunctionDeclaration;
            let paramCount = 0;
            if (originNode && originNode.parameters) {
                paramCount = originNode.parameters.length;
            }

            const varName = generateQJSVarName(QJSCType.JSValue, jsName, true);
            const qjsVar = qjsNewVar(undefined, QJSCType.JSValue, varName);
            const jsVar = qjsNewJSVar(jsName, QJSJSType.Function, QJSJSVarKind.ModuleVar, qjsVar);
            jsVar.flags |= QJSJSVarFlags.isJSCFunction;

            writeQJSKeyword(qjsTypeInfo[QJSCType.JSValue].type);
            writeQJSSpace();

            const tempVar = prepareQJSTempVar(QJSCType.JSValue, QJSJSType.Object);
            popQJSValueStack();
            emitQJSNewCFunction(tempVar, jsName, paramCount);

            let qjsAtomVar = qjsAtomMap.get(jsName);
            if (!!jsName.length && !qjsAtomVar) {
                const atomName = qjsTypeInfo[QJSCType.JSAtom].prefix + jsName;//qjsAtomIndex.toString();
                qjsAtomVar = qjsNewVar(undefined, QJSCType.JSAtom, atomName, true, true);
                qjsAtomMap.set(jsName, qjsAtomVar);
            }

            writeQJSBase("var_refs["+ localIndex + "]");
            writeQJSSpace();
            writeQJSPunctuation("=");
            writeQJSSpace();
            if (isExport && !isImport) {
                emitQJSSetModuleExportByIndex(importOrExportIndex, qjsAtomVar!, tempVar);
            }

            writeQJSKeyword(qjsTypeInfo[QJSCType.JSValue].type);
            writeQJSSpace();
            writeQJSBase(qjsVar.name);
            writeQJSSpace();
            writeQJSPunctuation("=");
            writeQJSSpace();
            writeQJSBase("var_refs["+ localIndex + "]->pvalue");
            writeQJSTrailingSemicolon();
            writeLine();

            qjsVar.needfree = false;

            jsVar.inited = true;
            jsVar.needsync = false;
            jsVar.index = localIndex;
        }

        function emitQJSUpdateCallStackFrameBuf(argCount: number, varCount: number) {
            writeQJSBase("JSStackFrame * sf = ");
            writeQJSBase(generateQJSUpdateFrameBuf1(argCount.toString(), varCount.toString()));
            writeQJSTrailingSemicolon();
            writeQJSLine();
            writeQJSBase(generateQJSUpdateFrameBuf2(argCount.toString(), varCount.toString()));
            writeQJSTrailingSemicolon();
            writeQJSLine(2);
        }

        function checkQJSModifier(modifiers: ModifiersArray | undefined, modifier: SyntaxKind): boolean {
            if (!modifiers) {
                return false;
            }

            let found = false;
            modifiers.forEach((value) => {
                if (value.kind === modifier) {
                    found = true;
                    return;
                }
            });

            return found;
        }

        function emitQJSVarDefList(node?: Node) {
            if (!checker || !node || !node.locals) {
                return;
            }

            const curFrame = qjsGetCurFrame();
            const curFunc = qjsGetCurFunction(curFrame);
            let varkind: QJSJSVarKind = QJSJSVarKind.LocalVar;
            if (curFunc.kind === SyntaxKind.SourceFile) {
                if (qjsEvalType === QJSEvalType.Global) {
                    if (curFrame.container.kind === SyntaxKind.SourceFile) {
                        varkind = QJSJSVarKind.GlobalVar;
                    }
                }
                else {
                    Debug.assert(qjsEvalType === QJSEvalType.Module);
                    varkind = QJSJSVarKind.ModuleVar;
                }
            }

            if (node.kind === SyntaxKind.FunctionDeclaration) {
                const funcdecl = node as FunctionDeclaration;
                emitQJSUpdateCallStackFrameBuf(funcdecl.parameters.length,
                    funcdecl.localsCount - funcdecl.parameters.length);
            }

            let argCount = 0;
            if (node.kind !== SyntaxKind.FunctionDeclaration &&
                curFunc.kind === SyntaxKind.FunctionDeclaration) {
                argCount = (curFunc as FunctionDeclaration).parameters.length;
            }

            let exportIndex = -1;
            let importIndex = -1;
            let localIndex = -1;
            node.locals.forEach((value, _) => {
                localIndex ++;

                let valueDecl: Declaration;
                const type = checker.getTypeOfSymbol(value);
                (type);

                if (value.valueDeclaration) {
                    valueDecl = value.valueDeclaration;
                    if (valueDecl.kind === SyntaxKind.VariableDeclaration &&
                        valueDecl.parent.parent.kind === SyntaxKind.VariableStatement &&
                        checkQJSModifier((valueDecl.parent.parent as VariableStatement).modifiers, SyntaxKind.DeclareKeyword)) {
                        return;
                    }
                }
                else if (value.exportSymbol &&
                    value.exportSymbol.valueDeclaration) {
                    valueDecl = value.exportSymbol.valueDeclaration;
                    exportIndex ++;
                }
                else {
                    valueDecl = value.declarations![0];
                    importIndex ++;
                }

                const jsName = getTextOfNode((valueDecl as VariableDeclaration).name, false);
                if (!!hasGlobalName!(jsName)) {
                    varkind = QJSJSVarKind.GlobalVar;
                }
                switch (valueDecl.kind) {
                    case SyntaxKind.VariableDeclaration:
                        if (varkind === QJSJSVarKind.GlobalVar) {
                            emitQJSGlobalVarDef(value);
                        }
                        else if (varkind === QJSJSVarKind.ModuleVar) {
                            emitQJSModuleVarDef(localIndex, exportIndex, value);
                        }
                        else {
                            Debug.assert(value.stackIndex !== undefined);
                            emitQJSLocalVarDef(value.stackIndex - argCount, value);
                        }
                        break;
                    case SyntaxKind.Parameter:
                        emitQJSArgVarDef(argCount, value);
                        argCount ++;
                        break;
                    case SyntaxKind.FunctionDeclaration:
                        if (varkind === QJSJSVarKind.LocalVar) {
                            emitQJSLocalFunctionVarDef(value.stackIndex! - argCount, value, argCount);
                        }
                        else if (varkind === QJSJSVarKind.ModuleVar) {
                            emitQJSModuleFunctionVarDef(localIndex, exportIndex, value);
                        }
                        else {
                            emitQJSGlobalFunctionVarDef(value);
                        }

                        break;
                    case SyntaxKind.ImportSpecifier:
                        //const type = checker!.getTypeOfSymbol(value);
                        //if (type.flags & TypeFlags.Object) {
                            emitQJSModuleVarDef(localIndex, importIndex, value);
                        //}

                        break;
                    case SyntaxKind.ClassDeclaration:
                        break;
                    default:
                        break;
                }

                writeQJSLine(2);
            });
        }

        function qjsReserveNameInNestedScopes(name: string) {
            if (!qjsReservedScopeNames || qjsReservedScopeNames === lastOrUndefined(qjsReservedNameStack)) {
                qjsReservedScopeNames = new Set();
            }
            qjsReservedScopeNames.add(name);
        }

        function qjsPushNameGenerationScope(flags: EmitFlags = EmitFlags.None) {
            if (flags & EmitFlags.ReuseTempVariableScope) {
                return;
            }

            qjsReservedNameStack.push(qjsReservedScopeNames);
        }

        function qjsPopNameGenerationScope(flags: EmitFlags = EmitFlags.None) {
            if (flags & EmitFlags.ReuseTempVariableScope) {
                return;
            }
            qjsReservedScopeNames = qjsReservedNameStack.pop()!;
        }

        function qjsGetCurFunction(frame: QJSFrame): Node {
            while(frame.preframe) {
                if (frame.container.kind === SyntaxKind.FunctionDeclaration) {
                    return frame.container;
                }

                frame = frame.preframe;
            }

            return frame.container;;
        }

        function qjsNewFrame(node: Node, frameName?: string): QJSFrame {
            const isFunc = (node.kind === SyntaxKind.FunctionDeclaration);
            const curFrame = qjsGetCurFrame();

            let blocktype = "block";
            switch (qjsCurBlockType) {
                case QJSBlockType.IfThen:
                    blocktype = "ifthen";
                    break;
                case QJSBlockType.IfElse:
                    blocktype = "ifelse";
                    break;
                case QJSBlockType.FuncBody:
                    blocktype = "func";
                    break;
                case QJSBlockType.Loop:
                    blocktype = "loop";
                    break;
                default:
                    break;
            }

            let frameid = "";

            if (qjsCallFrames.length === 0) {
                frameid = "root";
            }
            else {
                frameid = curFrame.id + "->" + curFrame.children.length + ":" + blocktype;

            }

            if (frameName) {
                frameid = frameName + ":" + blocktype;
            }

            let functionContainer: Node;
            if (node.kind === SyntaxKind.SourceFile || node.kind === SyntaxKind.FunctionDeclaration) {
                functionContainer = node;
            }
            else {
                functionContainer = curFrame.function;
            }

            const newFrame: QJSFrame = {
                id: frameid,
                in: [],
                children: [],
                container: node,
                function: functionContainer,
                preframe: undefined,
                needEmitReturn: isFunc,
                vars: [],
                jsvarmap: new Map<string, QJSJSVar>(),
                phinodes: [],
            };

            newFrame.preframe = curFrame;
            if (curFrame) {
                curFrame.children.push(newFrame);
            }

            qjsCallFrames.push(newFrame);

            return newFrame;
        }

        function emitQJSBlockBegin(node: Node, frameName?: string) {
            if (!printerOptions.emitQJSCode) {
                return;
            }

            qjsNewFrame(node, frameName);

            writeTokenText(SyntaxKind.OpenBraceToken, writeQJSPunctuation);
            writeQJSLine();
            increaseQJSIndent();
        }

        function emitQJSBlockEnd() {
            if (!printerOptions.emitQJSCode) {
                return;
            }

            emitQJSFreeVars();
            if (qjsCallFrames.length === 1) {
                //emitQJSCFunctionCall(QJSReserved.FreeAtomTableFunc, QJSReserved.DefaultCtx);
            }
            if (qjsGetCurFrame().needEmitReturn) {
                writeQJSKeyword(QJSReserved.Return);
                writeQJSSpace();
                if (qjsEvalType === QJSEvalType.Global) {
                    writeQJSKeyword(QJSReserved.JSUndefined);
                }
                else {
                    writeQJSBase("0");
                }
                writeQJSTrailingSemicolon();
                writeQJSLine();
            }

            decreaseQJSIndent();
            writeTokenText(SyntaxKind.CloseBraceToken, writeQJSPunctuation);
            qjsCallFrames.pop();
        }

        function emitQJSFunctionBegin(node: Node, prefix: string, name: string, rettype: QJSCType, signature: string = QJSReserved.DefaultFuncParams): string {
            if (node.kind !== SyntaxKind.SourceFile) {
                writeQJSPush();
            }

            const func_name = prefix + name;
            qjsGeneratedNames.add(func_name);
            const retval = qjsTypeInfo[rettype].type;
            const func_def = QJSReserved.Static + " " + retval + " " + func_name + signature;
            qjsFuncDecls.push(func_def);

            writeQJSBase(func_def);
            writeQJSLine();

            const savedBlockType = qjsCurBlockType;
            qjsCurBlockType = QJSBlockType.FuncBody;
            emitQJSBlockBegin(node, func_name);
            qjsCurBlockType = savedBlockType;

            qjsPushNameGenerationScope();

            qjsGetCurFrame().needEmitReturn = true;

            return func_name;
        }

        function emitQJSFunctionEnd(node: Node) {
            emitQJSBlockEnd();
            qjsPopNameGenerationScope();
            writeQJSLine(2);
            if (node.kind !== SyntaxKind.SourceFile) {
                writeQJSPop();
            }
        }

        function emitQJSFunctionEvalFileBegin(node: SourceFile) {
            const name = removeFileExtension(getBaseFileName(node.fileName));
            const rettype = qjsEvalType === QJSEvalType.Module ? QJSCType.Int : QJSCType.JSValue;
            const signature = qjsEvalType === QJSEvalType.Module ? QJSReserved.DefaultModuleFuncParams :
                QJSReserved.DefaultFuncParams;
            qjsInitFuncName = emitQJSFunctionBegin(node, QJSReserved.FileFuncPrefix, name, rettype, signature);
        }

        function emitQJSFreeAtom(atom: QJSVar) {
            writeQJSBase(generateQJSFreeAtom(atom));
            writeQJSTrailingSemicolon();
            writeQJSLine();
        }

        function emitQJSFreeValue(val: QJSVar) {
            if (val.type !== QJSCType.JSValue ||
                !val.needfree ||
                (val.jsvar && !val.jsvar.inited)) {
                return;
            }

            writeQJSBase(generateQJSFreeValue(val));
            writeQJSTrailingSemicolon();
            writeQJSLine();
        }

        function qjsWriteBackObjects(frame?: QJSFrame) {
            const curFrame = frame ? frame : qjsGetCurFrame();
            const qjsJSVarMap = curFrame.jsvarmap;

            qjsJSVarMap.forEach((value, key) => {
                if (value.kind === QJSJSVarKind.GlobalVar) {
                    const qjsVar = value.cvar;
                    if (qjsVar &&
                        value.needsync) {
                        const atom = qjsAtomMap.get(value.name)!;
                        emitQJSSetGlobalVar(atom, qjsVar, "1");
                        value.needsync = false;
                    }
                }
                else if (value.kind === QJSJSVarKind.Prop) {
                    const qjsVar = value.cvar;
                    if (qjsVar &&
                        value.needsync) {
                        const [obj, name] = key.split("|");
                        const atom = qjsAtomMap.get(name)!;
                        emitQJSSetProperty(obj, atom, qjsVar);
                        value.needsync = false;
                    }
                }
            });

            writeQJSLine(2);

        }

        function qjsHasExistedValueStack(qjsVar: QJSVar): boolean {
            for (let i = qjsValueStack.length - 1; i >= 0; i --) {
                if (qjsValueStack[i] === qjsVar) {
                    return true;
                }
            }

            return false;
        }

        function qjsResetObjects(frame?: QJSFrame) {
            const curFrame = frame ? frame : qjsGetCurFrame();
            const qjsJSVarMap = curFrame.jsvarmap;

            qjsJSVarMap.forEach((value, _) => {
                if (qjsHasExistedValueStack(value.cvar)) {
                    return;
                }

                if (value.kind === QJSJSVarKind.GlobalVar &&
                    value.type !== QJSJSType.Function &&
                    value.inited) {
                    emitQJSFreeValue(value.cvar);
                    value.inited = false;
                }
                else if (value.kind === QJSJSVarKind.Prop &&
                        value.inited) {
                    emitQJSFreeValue(value.cvar);
                    value.inited = false;
                }
            });

        }

        function qjsResetCurFrameVarMap(frame?: QJSFrame) {
            const curFrame = frame ? frame : qjsGetCurFrame();

             // write back global var, prop etc.
            const qjsJSVarMap = curFrame.jsvarmap;
            qjsJSVarMap.forEach((value, key) => {
                if (value.kind === QJSJSVarKind.LocalVar) {
                    if (curFrame.preframe) {
                        //const jsvar = curFrame.preframe.jsvarmap.get(value.name);
                        const outerJsVar = value.outer;
                        if (outerJsVar) {
                            value.cvar.jsvar = outerJsVar;
                            value.cvar.value = outerJsVar.value;
                            value.cvar.jstype = outerJsVar.type;
                        }

                    }
                }
                else if (value.kind === QJSJSVarKind.GlobalVar) {
                    const qjsVar = value.cvar;
                    if (qjsVar &&
                        value.needsync &&
                        !value.outer) {
                        const atom = qjsAtomMap.get(value.name)!;
                        emitQJSSetGlobalVar(atom, qjsVar, "1");
                        value.needsync = false;
                    }

                    if (value.outer) {
                        value.outer.cvar.jsvar = value.outer;
                    }
                }
                else if (value.kind === QJSJSVarKind.Prop) {
                    const qjsVar = value.cvar;
                    if (qjsVar &&
                        value.needsync &&
                        (!value.outer || !qjsConfig.enableLazyWriteBack)) {
                        const [obj, name] = key.split("|");
                        const atomName = qjsAtomMap.get(name)!;
                        emitQJSSetProperty(obj, atomName, qjsVar);
                        value.needsync = false;
                    }

                    if (value.outer) {
                        value.outer.cvar.jsvar = value.outer;
                    }
                }
            });
        }

        // free and pop the vars within current frame, and
        // if isReturn is true, free vars until function frame
        function emitQJSFreeVars(isReturn = false) {
            const curFrame = qjsGetCurFrame();
            if (!curFrame) {
                return;
            }

            if (curFrame.vars.length === 0 && !isReturn) {
                return;
            }

            let funcFrame: QJSFrame = curFrame;
            if (isReturn) {
                // find the function frame
                while (funcFrame.container.kind !== SyntaxKind.FunctionDeclaration) {
                    funcFrame = funcFrame.preframe!;
                }
            }

            qjsResetCurFrameVarMap(curFrame);

            writeQJSLine(2);

            let frame = curFrame;
            while (frame !== funcFrame.preframe) {
                let start = frame.vars.length - 1;
                while (start >= 0) {
                    let qjsVar: QJSVar;
                    if (frame === curFrame) {
                        qjsVar = frame.vars.pop()!;
                        //if (qjsVar.jsvar) {
                        //    const qjsJSVarMap = frame.jsvarmap;
                        //    qjsJSVarMap.delete(qjsVar.jsvar.name);
                        //}
                    }
                    else {
                        qjsVar = frame.vars[start];
                    }

                    start --;

                    if (!qjsVar.needfree) {
                        continue;
                    }

                    switch (qjsVar.type) {
                        case QJSCType.JSValue:
                            emitQJSFreeValue(qjsVar);
                            break;
                        case QJSCType.JSAtom:
                            //emitQJSWriteBack(qjsVar);
                            emitQJSFreeAtom(qjsVar);
                            break;
                        default:
                            break;
                    }
                }

                frame = frame.preframe!;
            }
        }

        function emitQJSStaticVarDeclaration() {
            qjsAtomMap.forEach((value, _) => {
                writeQJSKeyword(QJSReserved.Static);
                writeQJSSpace();
                writeQJSKeyword(qjsTypeInfo[QJSCType.JSAtom].type);
                writeQJSSpace();
                writeQJSKeyword(value.name);
                writeQJSTrailingSemicolon();
                writeQJSLine();
            });
            writeQJSLine(2);
        }

        function emitQJSInitAtomTable() {
            writeQJSKeyword(QJSReserved.Static);
            writeQJSSpace();
            writeQJSKeyword(qjsTypeInfo[QJSCType.Void].type);
            writeQJSSpace();
            writeQJSKeyword(QJSReserved.InitAtomTableFunc);
            writeQJSPunctuation("(");
            writeQJSBase(QJSReserved.DefaultFuncCtxParam);
            writeQJSPunctuation(")");
            writeQJSSpace();
            writeQJSPunctuation("{");
            writeQJSLine();
            increaseQJSIndent();
            qjsAtomMap.forEach((value, key) => {

                emitQJSNewAtom(value, key);
            });
            decreaseQJSIndent();
            writeQJSPunctuation("}");
            writeQJSLine(2);
        }

        function emitQJSFreeAtomTable() {
            writeQJSKeyword(QJSReserved.Static);
            writeQJSSpace();
            writeQJSKeyword(qjsTypeInfo[QJSCType.Void].type);
            writeQJSSpace();
            writeQJSKeyword(QJSReserved.FreeAtomTableFunc);
            writeQJSPunctuation("(");
            writeQJSBase(QJSReserved.DefaultFuncCtxParam);
            writeQJSPunctuation(")");
            writeQJSSpace();
            writeQJSPunctuation("{");
            writeQJSLine();
            increaseQJSIndent();
            qjsAtomMap.forEach((value, _) => {
                emitQJSFreeAtom(value);
            });
            decreaseQJSIndent();
            writeQJSPunctuation("}");
            writeQJSLine(2);
        }

        function emitQJSAtomTableFuncs() {
            //writeQJSPush();
            emitQJSStaticVarDeclaration();
            emitQJSInitAtomTable();
            emitQJSFreeAtomTable();
            //writeQJSPop();
        }

        function emitQJSFuncDecls() {
            qjsFuncDecls.forEach(decl => {
                writeQJSBase(decl);
                writeQJSTrailingSemicolon();
                writeQJSLine();
            });

            writeQJSLine(2);
        }

        function emitQJSCFunctionCall(funcName: string, params = "") {
            writeQJSKeyword(funcName);
            writeQJSPunctuation("(");
            writeQJSBase(params);
            writeQJSPunctuation(")");
            writeQJSTrailingSemicolon();
            writeQJSLine(2);
        }

        function emitQJSMain(node: SourceFile) {
            const name = removeFileExtension(getBaseFileName(node.fileName));
            const func_name = QJSReserved.FileFuncPrefix + name;
            const atomName = qjsTypeInfo[QJSCType.JSAtom].prefix + QJSReserved.DefaultEntryFunc;
            const qjsAtomVar = qjsNewVar(undefined, QJSCType.JSAtom, atomName, true, true);
            qjsAtomMap.set(QJSReserved.DefaultEntryFunc, qjsAtomVar);

            writeQJSPush();
            writeQJSBase("#include \"tsvm_helper.h\"");
            writeQJSLine(2);
            emitQJSAtomTableFuncs();
            emitQJSFuncDecls();
            writeQJSPop();

            writeQJSBase("int main(int argc, char **argv)\n");
            writeQJSPunctuation("{");
            writeQJSLine();
            increaseQJSIndent();
            writeQJSBase("JSRuntime *rt;\n");
            writeQJSBase("JSContext *ctx;\n");
            writeQJSBase("JSValue obj_global;\n\n");
            writeQJSBase("rt = JS_NewRuntime();\n");
            writeQJSBase("ctx = JS_NewCustomContext(rt);\n\n");
            writeQJSBase("js_std_add_helpers(ctx, 0, NULL);\n\n");
            writeQJSBase("printf(\"This is auto-generated by TaiJS.\\n\");\n");
            emitQJSCFunctionCall(QJSReserved.InitAtomTableFunc, QJSReserved.DefaultCtx);
            writeQJSBase("obj_global = JS_GetGlobalObject(ctx);\n");
            writeQJSBase("JSValue obj_js_main = JS_NewCFunction(ctx, " + func_name + ", \"" + QJSReserved.DefaultEntryFunc + "\", 0);\n");
            writeQJSBase("JS_DefineGlobalFunction(ctx, " + atomName + ", obj_js_main, 0);\n");
            writeQJSBase("JS_Call(ctx, obj_js_main, obj_global, 0, NULL);\n\n");

            writeQJSBase("JS_FreeValue(ctx, obj_js_main);\n");
            writeQJSBase("JS_FreeValue(ctx, obj_global);\n\n");
            emitQJSCFunctionCall(QJSReserved.FreeAtomTableFunc, QJSReserved.DefaultCtx);
            writeQJSBase("JS_FreeContext(ctx);\n");
            writeQJSBase("JS_FreeRuntime(rt);\n");
            writeQJSBase("return 0;\n");
            decreaseQJSIndent();
            writeQJSPunctuation("}");
            writeQJSLine(2);

            //JSValue obj_js_main = JS_NewCFunction(ctx, js_eval_file_add, "js_eval_file_add", 0);
            //JSAtom atom_js_main = JS_NewAtom(ctx, "js_eval_file_add");
        }

        function emitQJSModuleInit(node: SourceFile) {
            const name = removeFileExtension(getBaseFileName(node.fileName));
            const initModuleName = QJSReserved.InitModulePrefix + name;

            writeQJSBase("#ifdef JS_SHARED_LIBRARY\n");
            writeQJSBase("#define JS_INIT_MODULE js_init_module\n");
            writeQJSBase("#else\n");
            writeQJSBase("#define JS_INIT_MODULE " + initModuleName + "\n");
            writeQJSBase("#endif\n");
            writeQJSLine(2);
            writeQJSKeyword(qjsTypeInfo[QJSCType.JSModuleDef].type);
            writeQJSBase(" * ");
            writeQJSKeyword("JS_INIT_MODULE");
            writeQJSBase("(JSContext *ctx, const JSAtom module_name)\n");
            writeQJSPunctuation("{");
            writeQJSLine();
            increaseQJSIndent();
            emitQJSCFunctionCall(QJSReserved.InitAtomTableFunc, QJSReserved.DefaultCtx);
            writeQJSBase("JSModuleDef * module = JS_NewJSCModule(ctx, module_name, " + qjsInitFuncName + ", " + node.locals!.size + ");\n");
            emitQJSModuleImports(node);
            emitQJSModuleExports(node);
            emitQJSCFunctionCall(QJSReserved.FreeAtomTableFunc, QJSReserved.DefaultCtx);
            writeQJSBase("return module;\n");
            decreaseQJSIndent();
            writeQJSPunctuation("}");
            writeQJSLine(2);

            writeQJSPush();
            writeQJSBase("#include \"tsvm_helper.h\"");
            writeQJSLine(2);
            emitQJSAtomTableFuncs();
            writeQJSPop();

            function emitQJSModuleExports(node: SourceFile) {
                const symbol = checker!.getSymbolAtLocation(node);

                if (!symbol!.exports) {
                    return;
                }

                symbol!.exports.forEach((_, key) => {
                    const exportName = unescapeLeadingUnderscores(key);
                    const varAtomName = qjsTypeInfo[QJSCType.JSAtom].prefix + exportName;
                    const qjsAtomVar = qjsNewVar(undefined, QJSCType.JSAtom, varAtomName, true, true);
                    if (!qjsAtomMap.get(exportName)) {
                        qjsAtomMap.set(exportName, qjsAtomVar);
                    }

                    writeQJSBase(QJSReserved.If + " (");
                    writeQJSBase(generateQJSAddModuleExportByAtom(qjsAtomVar));
                    writeQJSBase(")");
                    writeQJSLine();
                    increaseQJSIndent();
                    writeQJSBase(QJSReserved.Return + " NULL;");
                    writeQJSLine();
                    decreaseQJSIndent();
                });
                writeQJSLine(2);
            }

            type ImportedDeclaration = ImportClause | ImportSpecifier | NamespaceImport;
            function isImportedDeclaration(node: Node): node is ImportedDeclaration {
                return node.kind === SyntaxKind.ImportClause || node.kind === SyntaxKind.ImportSpecifier || node.kind === SyntaxKind.NamespaceImport;
            }

            function emitQJSModuleImports(node: SourceFile) {
                if (!node.imports || node.imports.length === 0) {
                    return;
                }

                if (!node.locals || node.locals.size === 0) {
                    return;
                }

                node.imports.forEach((module) => {
                    const modulePath = module.text;
                    const pathParts = getNormalizedPathComponents(module.text, "");
                    let moduleName = "";
                    pathParts.forEach((value, index, array) => {
                        if (value.length === 0) {
                            return;
                        }

                        if (hasExtension(value)) {
                            value = removeFileExtension(value);
                        }
                        moduleName += value;

                        if (index === (array.length - 1)) {
                            return;
                        }

                        moduleName += "_";
                    });
                    const varAtomName = qjsTypeInfo[QJSCType.JSAtom].prefix + moduleName;
                    const qjsAtomVar = qjsNewVar(undefined, QJSCType.JSAtom, varAtomName, true, true);
                    if (!qjsAtomMap.get(modulePath)) {
                        qjsAtomMap.set(modulePath, qjsAtomVar);
                    }

                    writeQJSBase(QJSReserved.If + " (");
                    writeQJSBase(generateQJSAddReqModule(qjsAtomVar));
                    writeQJSBase(")");
                    writeQJSLine();
                    increaseQJSIndent();
                    writeQJSBase(QJSReserved.Return + " NULL;");
                    writeQJSLine();
                    decreaseQJSIndent();
                });

                let index = -1;
                node.locals.forEach((value, _) => {
                    index ++;
                    if (value.valueDeclaration) {
                        return;
                    }

                    if (value.exportSymbol) {
                        return;
                    }

                    if (!isImportedDeclaration(value.declarations![0])) {
                        return;
                    }

                    const isExternalImportAlias = !!(value.flags & SymbolFlags.Alias) && !some(value.declarations, d =>
                        !!findAncestor(d, isExportDeclaration) ||
                        isNamespaceExport(d) ||
                        (isImportEqualsDeclaration(d) && !isExternalModuleReference(d.moduleReference))
                    );

                    const decl = value.declarations![0]! as ImportSpecifier;
                    const importName = decl.propertyName ? getTextOfNode(decl.propertyName) : getTextOfNode(decl.name);
                    const varAtomName = qjsTypeInfo[QJSCType.JSAtom].prefix + importName;
                    const qjsAtomVar = qjsNewVar(undefined, QJSCType.JSAtom, varAtomName, true, true);
                    if (!qjsAtomMap.get(importName)) {
                        qjsAtomMap.set(importName, qjsAtomVar);
                    }

                    if (!isExternalImportAlias) {
                        return;
                    }

                    writeQJSBase(QJSReserved.If + " (");
                    writeQJSBase(generateQJSAddModuleImportByAtom(qjsAtomVar, index));
                    writeQJSBase(")");
                    writeQJSLine();
                    increaseQJSIndent();
                    writeQJSBase(QJSReserved.Return + " NULL;");
                    writeQJSLine();
                    decreaseQJSIndent();
                });
                writeQJSLine(2);
            }
        }

        function emitQJSModuleFuncInit() {
            writeQJSBase(QJSFunction.JS_MODULE_FUNC_PROLOGUE);
            writeQJSBase("(m)");
            writeQJSTrailingSemicolon();
            writeQJSLine(2);
        }

        function emitSourceFileWorker(node: SourceFile) {
            const statements = node.statements;
            pushNameGenerationScope(node);
            forEach(node.statements, generateNames);

            if (!!printerOptions.emitQJSCode) {
                if (isExternalModule(node))  {
                    qjsEvalType = QJSEvalType.Module;
                }

                emitQJSFunctionEvalFileBegin(node);
                if (qjsEvalType === QJSEvalType.Module) {
                    emitQJSModuleFuncInit();
                }

                // currently, I choose to emit global var definition here, because of hoist needed.
                // otherwise, we can collect the vars within declaration nodes, and
                // go back here to emit definition.
                const originNode = getParseTreeNode(node);
                emitQJSVarDefList(originNode);
            }

            emitHelpers(node);
            const index = findIndex(statements, statement => !isPrologueDirective(statement));
            emitTripleSlashDirectivesIfNeeded(node);
            emitList(node, statements, ListFormat.MultiLine, /*parenthesizerRule*/ undefined, index === -1 ? statements.length : index);
            popNameGenerationScope(node);

            if (!!printerOptions.emitQJSCode) {
                writeQJSLine(2);
                emitQJSFunctionEnd(node);
                Debug.assert(qjsValueStack.length === 0);

                if (isExternalModule(node)) {
                    emitQJSModuleInit(node);
                }

                if (!isExternalModule(node)) {
                    emitQJSMain(node);
                }
            }
        }

        // Transformation nodes

        function emitPartiallyEmittedExpression(node: PartiallyEmittedExpression) {
            const emitFlags = getEmitFlags(node);
            if (!(emitFlags & EmitFlags.NoLeadingComments) && node.pos !== node.expression.pos) {
                emitTrailingCommentsOfPosition(node.expression.pos);
            }
            emitExpression(node.expression);
            if (!(emitFlags & EmitFlags.NoTrailingComments) && node.end !== node.expression.end) {
                emitLeadingCommentsOfPosition(node.expression.end);
            }
        }

        function emitCommaList(node: CommaListExpression) {
            emitExpressionList(node, node.elements, ListFormat.CommaListElements, /*parenthesizerRule*/ undefined);
        }

        /**
         * Emits any prologue directives at the start of a Statement list, returning the
         * number of prologue directives written to the output.
         */
        function emitPrologueDirectives(statements: readonly Node[], sourceFile?: SourceFile, seenPrologueDirectives?: Set<string>, recordBundleFileSection?: true): number {
            let needsToSetSourceFile = !!sourceFile;
            for (let i = 0; i < statements.length; i++) {
                const statement = statements[i];
                if (isPrologueDirective(statement)) {
                    const shouldEmitPrologueDirective = seenPrologueDirectives ? !seenPrologueDirectives.has(statement.expression.text) : true;
                    if (shouldEmitPrologueDirective) {
                        if (needsToSetSourceFile) {
                            needsToSetSourceFile = false;
                            setSourceFile(sourceFile);
                        }
                        writeLine();
                        const pos = writer.getTextPos();
                        emit(statement);
                        if (recordBundleFileSection && bundleFileInfo) bundleFileInfo.sections.push({ pos, end: writer.getTextPos(), kind: BundleFileSectionKind.Prologue, data: statement.expression.text });
                        if (seenPrologueDirectives) {
                            seenPrologueDirectives.add(statement.expression.text);
                        }
                    }
                }
                else {
                    // return index of the first non prologue directive
                    return i;
                }
            }

            return statements.length;
        }

        function emitUnparsedPrologues(prologues: readonly UnparsedPrologue[], seenPrologueDirectives: Set<string>) {
            for (const prologue of prologues) {
                if (!seenPrologueDirectives.has(prologue.data)) {
                    writeLine();
                    const pos = writer.getTextPos();
                    emit(prologue);
                    if (bundleFileInfo) bundleFileInfo.sections.push({ pos, end: writer.getTextPos(), kind: BundleFileSectionKind.Prologue, data: prologue.data });
                    if (seenPrologueDirectives) {
                        seenPrologueDirectives.add(prologue.data);
                    }
                }
            }
        }

        function emitPrologueDirectivesIfNeeded(sourceFileOrBundle: Bundle | SourceFile) {
            if (isSourceFile(sourceFileOrBundle)) {
                emitPrologueDirectives(sourceFileOrBundle.statements, sourceFileOrBundle);
            }
            else {
                const seenPrologueDirectives = new Set<string>();
                for (const prepend of sourceFileOrBundle.prepends) {
                    emitUnparsedPrologues((prepend as UnparsedSource).prologues, seenPrologueDirectives);
                }
                for (const sourceFile of sourceFileOrBundle.sourceFiles) {
                    emitPrologueDirectives(sourceFile.statements, sourceFile, seenPrologueDirectives, /*recordBundleFileSection*/ true);
                }
                setSourceFile(undefined);
            }
        }

        function getPrologueDirectivesFromBundledSourceFiles(bundle: Bundle): SourceFilePrologueInfo[] | undefined {
            const seenPrologueDirectives = new Set<string>();
            let prologues: SourceFilePrologueInfo[] | undefined;
            for (let index = 0; index < bundle.sourceFiles.length; index++) {
                const sourceFile = bundle.sourceFiles[index];
                let directives: SourceFilePrologueDirective[] | undefined;
                let end = 0;
                for (const statement of sourceFile.statements) {
                    if (!isPrologueDirective(statement)) break;
                    if (seenPrologueDirectives.has(statement.expression.text)) continue;
                    seenPrologueDirectives.add(statement.expression.text);
                    (directives || (directives = [])).push({
                        pos: statement.pos,
                        end: statement.end,
                        expression: {
                            pos: statement.expression.pos,
                            end: statement.expression.end,
                            text: statement.expression.text
                        }
                    });
                    end = end < statement.end ? statement.end : end;
                }
                if (directives) (prologues || (prologues = [])).push({ file: index, text: sourceFile.text.substring(0, end), directives });
            }
            return prologues;
        }

        function emitShebangIfNeeded(sourceFileOrBundle: Bundle | SourceFile | UnparsedSource) {
            if (isSourceFile(sourceFileOrBundle) || isUnparsedSource(sourceFileOrBundle)) {
                const shebang = getShebang(sourceFileOrBundle.text);
                if (shebang) {
                    writeComment(shebang);
                    writeLine();
                    return true;
                }
            }
            else {
                for (const prepend of sourceFileOrBundle.prepends) {
                    Debug.assertNode(prepend, isUnparsedSource);
                    if (emitShebangIfNeeded(prepend)) {
                        return true;
                    }
                }
                for (const sourceFile of sourceFileOrBundle.sourceFiles) {
                    // Emit only the first encountered shebang
                    if (emitShebangIfNeeded(sourceFile)) {
                        return true;
                    }
                }
            }
        }

        //
        // Helpers
        //

        function emitNodeWithWriter(node: Node | undefined, writer: typeof write) {
            if (!node) return;
            const savedWrite = write;
            write = writer;
            emit(node);
            write = savedWrite;
        }

        function emitModifiers(node: Node, modifiers: NodeArray<Modifier> | undefined) {
            if (modifiers && modifiers.length) {
                emitList(node, modifiers, ListFormat.Modifiers);
                writeSpace();
            }
        }

        function emitTypeAnnotation(node: TypeNode | undefined) {
            if (node) {
                writePunctuation(":");
                writeSpace();
                emit(node);
            }
        }

        function emitInitializer(node: Expression | undefined, equalCommentStartPos: number, container: Node, parenthesizerRule?: (node: Expression) => Expression) {
            if (node) {
                writeSpace();
                emitTokenWithComment(SyntaxKind.EqualsToken, equalCommentStartPos, writeOperator, container);
                writeSpace();
                emitExpression(node, parenthesizerRule);
            }
        }

        function emitNodeWithPrefix<T extends Node>(prefix: string, prefixWriter: (s: string) => void, node: T | undefined, emit: (node: T) => void) {
            if (node) {
                prefixWriter(prefix);
                emit(node);
            }
        }

        function emitWithLeadingSpace(node: Node | undefined) {
            if (node) {
                writeSpace();
                emit(node);
            }
        }

        function emitExpressionWithLeadingSpace(node: Expression | undefined, parenthesizerRule?: (node: Expression) => Expression) {
            if (node) {
                writeSpace();
                emitExpression(node, parenthesizerRule);
            }
        }

        function emitWithTrailingSpace(node: Node | undefined) {
            if (node) {
                emit(node);
                writeSpace();
            }
        }

        function emitEmbeddedStatement(parent: Node, node: Statement) {
            if (isBlock(node) || getEmitFlags(parent) & EmitFlags.SingleLine) {
                writeSpace();
                emit(node);
            }
            else {
                writeLine();
                increaseIndent();
                if (isEmptyStatement(node)) {
                    pipelineEmit(EmitHint.EmbeddedStatement, node);
                }
                else {
                    emit(node);
                }
                decreaseIndent();
            }
        }

        function emitDecorators(parentNode: Node, decorators: NodeArray<Decorator> | undefined) {
            emitList(parentNode, decorators, ListFormat.Decorators);
        }

        function emitTypeArguments(parentNode: Node, typeArguments: NodeArray<TypeNode> | undefined) {
            emitList(parentNode, typeArguments, ListFormat.TypeArguments, typeArgumentParenthesizerRuleSelector);
        }

        function emitTypeParameters(parentNode: SignatureDeclaration | InterfaceDeclaration | TypeAliasDeclaration | ClassDeclaration | ClassExpression, typeParameters: NodeArray<TypeParameterDeclaration> | undefined) {
            if (isFunctionLike(parentNode) && parentNode.typeArguments) { // Quick info uses type arguments in place of type parameters on instantiated signatures
                return emitTypeArguments(parentNode, parentNode.typeArguments);
            }
            emitList(parentNode, typeParameters, ListFormat.TypeParameters);
        }

        function emitParameters(parentNode: Node, parameters: NodeArray<ParameterDeclaration>) {
            emitList(parentNode, parameters, ListFormat.Parameters);
        }

        function canEmitSimpleArrowHead(parentNode: FunctionTypeNode | ArrowFunction, parameters: NodeArray<ParameterDeclaration>) {
            const parameter = singleOrUndefined(parameters);
            return parameter
                && parameter.pos === parentNode.pos // may not have parsed tokens between parent and parameter
                && isArrowFunction(parentNode)      // only arrow functions may have simple arrow head
                && !parentNode.type                 // arrow function may not have return type annotation
                && !some(parentNode.decorators)     // parent may not have decorators
                && !some(parentNode.modifiers)      // parent may not have modifiers
                && !some(parentNode.typeParameters) // parent may not have type parameters
                && !some(parameter.decorators)      // parameter may not have decorators
                && !some(parameter.modifiers)       // parameter may not have modifiers
                && !parameter.dotDotDotToken        // parameter may not be rest
                && !parameter.questionToken         // parameter may not be optional
                && !parameter.type                  // parameter may not have a type annotation
                && !parameter.initializer           // parameter may not have an initializer
                && isIdentifier(parameter.name);    // parameter name must be identifier
        }

        function emitParametersForArrow(parentNode: FunctionTypeNode | ArrowFunction, parameters: NodeArray<ParameterDeclaration>) {
            if (canEmitSimpleArrowHead(parentNode, parameters)) {
                emitList(parentNode, parameters, ListFormat.Parameters & ~ListFormat.Parenthesis);
            }
            else {
                emitParameters(parentNode, parameters);
            }
        }

        function emitParametersForIndexSignature(parentNode: Node, parameters: NodeArray<ParameterDeclaration>) {
            emitList(parentNode, parameters, ListFormat.IndexSignatureParameters);
        }

        function writeDelimiter(format: ListFormat) {
            switch (format & ListFormat.DelimitersMask) {
                case ListFormat.None:
                    break;
                case ListFormat.CommaDelimited:
                    writePunctuation(",");
                    break;
                case ListFormat.BarDelimited:
                    writeSpace();
                    writePunctuation("|");
                    break;
                case ListFormat.AsteriskDelimited:
                    writeSpace();
                    writePunctuation("*");
                    writeSpace();
                    break;
                case ListFormat.AmpersandDelimited:
                    writeSpace();
                    writePunctuation("&");
                    break;
            }
        }

        function emitList(parentNode: Node | undefined, children: NodeArray<Node> | undefined, format: ListFormat, parenthesizerRule?: ParenthesizerRuleOrSelector<Node>, start?: number, count?: number) {
            emitNodeList(emit, parentNode, children, format, parenthesizerRule, start, count);
        }

        function emitExpressionList(parentNode: Node | undefined, children: NodeArray<Node> | undefined, format: ListFormat, parenthesizerRule?: ParenthesizerRuleOrSelector<Expression>, start?: number, count?: number) {
            emitNodeList(emitExpression, parentNode, children, format, parenthesizerRule, start, count);
        }

        function emitNodeList(emit: (node: Node, parenthesizerRule?: ((node: Node) => Node) | undefined) => void, parentNode: Node | undefined, children: NodeArray<Node> | undefined, format: ListFormat, parenthesizerRule: ParenthesizerRuleOrSelector<Node> | undefined, start = 0, count = children ? children.length - start : 0) {
            const isUndefined = children === undefined;
            if (isUndefined && format & ListFormat.OptionalIfUndefined) {
                return;
            }

            const isEmpty = children === undefined || start >= children.length || count === 0;
            if (isEmpty && format & ListFormat.OptionalIfEmpty) {
                if (onBeforeEmitNodeArray) {
                    onBeforeEmitNodeArray(children);
                }
                if (onAfterEmitNodeArray) {
                    onAfterEmitNodeArray(children);
                }
                return;
            }

            if (format & ListFormat.BracketsMask) {
                writePunctuation(getOpeningBracket(format));
                if (isEmpty && children) {
                    emitTrailingCommentsOfPosition(children.pos, /*prefixSpace*/ true); // Emit comments within empty bracketed lists
                }
            }

            if (onBeforeEmitNodeArray) {
                onBeforeEmitNodeArray(children);
            }

            if (isEmpty) {
                // Write a line terminator if the parent node was multi-line
                if (format & ListFormat.MultiLine && !(preserveSourceNewlines && (!parentNode || rangeIsOnSingleLine(parentNode, currentSourceFile!)))) {
                    writeLine();
                }
                else if (format & ListFormat.SpaceBetweenBraces && !(format & ListFormat.NoSpaceIfEmpty)) {
                    writeSpace();
                }
            }
            else {
                Debug.type<NodeArray<Node>>(children);
                // Write the opening line terminator or leading whitespace.
                const mayEmitInterveningComments = (format & ListFormat.NoInterveningComments) === 0;
                let shouldEmitInterveningComments = mayEmitInterveningComments;
                const leadingLineTerminatorCount = getLeadingLineTerminatorCount(parentNode, children, format); // TODO: GH#18217
                if (leadingLineTerminatorCount) {
                    writeLine(leadingLineTerminatorCount);
                    shouldEmitInterveningComments = false;
                }
                else if (format & ListFormat.SpaceBetweenBraces) {
                    writeSpace();
                }

                // Increase the indent, if requested.
                if (format & ListFormat.Indented) {
                    increaseIndent();
                }

                const emitListItem = getEmitListItem(emit, parenthesizerRule);

                // Emit each child.
                let previousSibling: Node | undefined;
                let previousSourceFileTextKind: ReturnType<typeof recordBundleFileInternalSectionStart>;
                let shouldDecreaseIndentAfterEmit = false;
                for (let i = 0; i < count; i++) {
                    const child = children[start + i];

                    // Write the delimiter if this is not the first node.
                    if (format & ListFormat.AsteriskDelimited) {
                        // always write JSDoc in the format "\n *"
                        writeLine();
                        writeDelimiter(format);
                    }
                    else if (previousSibling) {
                        // i.e
                        //      function commentedParameters(
                        //          /* Parameter a */
                        //          a
                        //          /* End of parameter a */ -> this comment isn't considered to be trailing comment of parameter "a" due to newline
                        //          ,
                        if (format & ListFormat.DelimitersMask && previousSibling.end !== (parentNode ? parentNode.end : -1)) {
                            emitLeadingCommentsOfPosition(previousSibling.end);
                        }
                        writeDelimiter(format);
                        recordBundleFileInternalSectionEnd(previousSourceFileTextKind);

                        // Write either a line terminator or whitespace to separate the elements.
                        const separatingLineTerminatorCount = getSeparatingLineTerminatorCount(previousSibling, child, format);
                        if (separatingLineTerminatorCount > 0) {
                            // If a synthesized node in a single-line list starts on a new
                            // line, we should increase the indent.
                            if ((format & (ListFormat.LinesMask | ListFormat.Indented)) === ListFormat.SingleLine) {
                                increaseIndent();
                                shouldDecreaseIndentAfterEmit = true;
                            }

                            writeLine(separatingLineTerminatorCount);
                            shouldEmitInterveningComments = false;
                        }
                        else if (previousSibling && format & ListFormat.SpaceBetweenSiblings) {
                            writeSpace();
                        }
                    }

                    // Emit this child.
                    previousSourceFileTextKind = recordBundleFileInternalSectionStart(child);
                    if (shouldEmitInterveningComments) {
                        const commentRange = getCommentRange(child);
                        emitTrailingCommentsOfPosition(commentRange.pos);
                    }
                    else {
                        shouldEmitInterveningComments = mayEmitInterveningComments;
                    }

                    nextListElementPos = child.pos;
                    emitListItem(child, emit, parenthesizerRule, i);

                    if (shouldDecreaseIndentAfterEmit) {
                        decreaseIndent();
                        shouldDecreaseIndentAfterEmit = false;
                    }

                    previousSibling = child;
                }

                // Write a trailing comma, if requested.
                const emitFlags = previousSibling ? getEmitFlags(previousSibling) : 0;
                const skipTrailingComments = commentsDisabled || !!(emitFlags & EmitFlags.NoTrailingComments);
                const hasTrailingComma = children?.hasTrailingComma && (format & ListFormat.AllowTrailingComma) && (format & ListFormat.CommaDelimited);
                if (hasTrailingComma) {
                    if (previousSibling && !skipTrailingComments) {
                        emitTokenWithComment(SyntaxKind.CommaToken, previousSibling.end, writePunctuation, previousSibling);
                    }
                    else {
                        writePunctuation(",");
                    }
                }

                // Emit any trailing comment of the last element in the list
                // i.e
                //       var array = [...
                //          2
                //          /* end of element 2 */
                //       ];
                if (previousSibling && (parentNode ? parentNode.end : -1) !== previousSibling.end && (format & ListFormat.DelimitersMask) && !skipTrailingComments) {
                    emitLeadingCommentsOfPosition(hasTrailingComma && children?.end ? children.end : previousSibling.end);
                }

                // Decrease the indent, if requested.
                if (format & ListFormat.Indented) {
                    decreaseIndent();
                }

                recordBundleFileInternalSectionEnd(previousSourceFileTextKind);

                // Write the closing line terminator or closing whitespace.
                const closingLineTerminatorCount = getClosingLineTerminatorCount(parentNode, children, format);
                if (closingLineTerminatorCount) {
                    writeLine(closingLineTerminatorCount);
                }
                else if (format & (ListFormat.SpaceAfterList | ListFormat.SpaceBetweenBraces)) {
                    writeSpace();
                }
            }

            if (onAfterEmitNodeArray) {
                onAfterEmitNodeArray(children);
            }

            if (format & ListFormat.BracketsMask) {
                if (isEmpty && children) {
                    emitLeadingCommentsOfPosition(children.end); // Emit leading comments within empty lists
                }
                writePunctuation(getClosingBracket(format));
            }
        }

        // Writers
        function writeQJSPush() {
            qjsWriter!.push!();
        }

        function writeQJSPop() {
            qjsWriter!.pop!();
        }

        function writeLiteral(s: string) {
            if (qjsPauseJSEmit) {
                return;
            }
            writer.writeLiteral(s);
        }

        function writeStringLiteral(s: string) {
            if (qjsPauseJSEmit) {
                return;
            }
            writer.writeStringLiteral(s);
        }

        function writeBase(s: string) {
            if (qjsPauseJSEmit) {
                return;
            }
            writer.write(s);
        }

        function writeQJSBase(s: string) {
            qjsWriter!.write(s);
        }

        function writeSymbol(s: string, sym: Symbol) {
            if (qjsPauseJSEmit) {
                return;
            }
            writer.writeSymbol(s, sym);
        }

        function writePunctuation(s: string) {
            if (qjsPauseJSEmit) {
                return;
            }
            writer.writePunctuation(s);
        }

        function writeQJSPunctuation(s: string) {
            qjsWriter!.writePunctuation(s);
        }

        function writeTrailingSemicolon() {
            if (qjsPauseJSEmit) {
                return;
            }
            writer.writeTrailingSemicolon(";");
        }

        function writeQJSTrailingSemicolon() {
            qjsWriter!.writeTrailingSemicolon(";");
        }

        function writeKeyword(s: string) {
            if (qjsPauseJSEmit) {
                return;
            }
            writer.writeKeyword(s);
        }

        function writeQJSKeyword(s: string) {
            qjsWriter!.writeKeyword(s);
        }

        function writeOperator(s: string) {
            if (qjsPauseJSEmit) {
                return;
            }
            writer.writeOperator(s);
        }

        function writeQJSOperator(s: string) {
            qjsWriter!.writeOperator(s);
        }

        function writeParameter(s: string) {
            if (qjsPauseJSEmit) {
                return;
            }
            writer.writeParameter(s);
        }

        function writeComment(s: string) {
            if (qjsPauseJSEmit) {
                return;
            }
            writer.writeComment(s);
        }

        function writeQJSComment(s: string) {
            qjsWriter!.writeComment(s);
        }

        function writeSpace() {
            if (qjsPauseJSEmit) {
                return;
            }
            writer.writeSpace(" ");
        }

        function writeQJSSpace() {
            qjsWriter!.writeSpace(" ");
        }

        function writeProperty(s: string) {
            if (qjsPauseJSEmit) {
                return;
            }
            writer.writeProperty(s);
        }

        function nonEscapingWrite(s: string) {
            if (qjsPauseJSEmit) {
                return;
            }
            // This should be defined in a snippet-escaping text writer.
            if (writer.nonEscapingWrite) {
                writer.nonEscapingWrite(s);
            }
            else {
                writer.write(s);
            }
        }

        function writeLine(count = 1) {
            if (qjsPauseJSEmit) {
                return;
            }
            for (let i = 0; i < count; i++) {
                writer.writeLine(i > 0);
            }
        }

        function writeQJSLine(count = 1) {
            for (let i = 0; i < count; i++) {
                qjsWriter!.writeLine(i > 0);
            }
        }

        function increaseIndent() {
            if (qjsPauseJSEmit) {
                return;
            }
            writer.increaseIndent();
        }

        function increaseQJSIndent() {
            qjsWriter!.increaseIndent();
        }

        function decreaseIndent() {
            if (qjsPauseJSEmit) {
                return;
            }
            writer.decreaseIndent();
        }

        function decreaseQJSIndent() {
            qjsWriter!.decreaseIndent();
        }

        function writeToken(token: SyntaxKind, pos: number, writer: (s: string) => void, contextNode?: Node) {
            return !sourceMapsDisabled
                ? emitTokenWithSourceMap(contextNode, token, writer, pos, writeTokenText)
                : writeTokenText(token, writer, pos);
        }

        function writeQJSTokenNode(node: Node) {
            if (!printerOptions.emitQJSCode) {
                return;
            }

            if (node.kind === SyntaxKind.TrueKeyword ||
                node.kind === SyntaxKind.FalseKeyword) {
                const val = prepareQJSTempVar(QJSCType.Bool, QJSJSType.Bool);
                writeQJSKeyword(qjsTypeInfo[QJSCType.Bool].type);
                writeQJSSpace();
                writeQJSBase(val.name);
                writeQJSSpace();
                writeQJSPunctuation("=");
                writeQJSSpace();
                writeQJSBase(node.kind === SyntaxKind.TrueKeyword ? QJSReserved.True : QJSReserved.False);
                writeQJSTrailingSemicolon();
                writeQJSLine();
            }
        }

        function writeTokenNode(node: Node, writer: (s: string) => void) {
            if (onBeforeEmitToken) {
                onBeforeEmitToken(node);
            }
            writer(tokenToString(node.kind)!);
            writeQJSTokenNode(node);
            if (onAfterEmitToken) {
                onAfterEmitToken(node);
            }
        }

        function writeTokenText(token: SyntaxKind, writer: (s: string) => void): void;
        function writeTokenText(token: SyntaxKind, writer: (s: string) => void, pos: number): number;
        function writeTokenText(token: SyntaxKind, writer: (s: string) => void, pos?: number): number {
            const tokenString = tokenToString(token)!;
            writer(tokenString);
            return pos! < 0 ? pos! : pos! + tokenString.length;
        }

        function writeLineOrSpace(parentNode: Node, prevChildNode: Node, nextChildNode: Node) {
            if (getEmitFlags(parentNode) & EmitFlags.SingleLine) {
                writeSpace();
            }
            else if (preserveSourceNewlines) {
                const lines = getLinesBetweenNodes(parentNode, prevChildNode, nextChildNode);
                if (lines) {
                    writeLine(lines);
                }
                else {
                    writeSpace();
                }
            }
            else {
                writeLine();
            }
        }

        function writeLines(text: string): void {
            const lines = text.split(/\r\n?|\n/g);
            const indentation = guessIndentation(lines);
            for (const lineText of lines) {
                const line = indentation ? lineText.slice(indentation) : lineText;
                if (line.length) {
                    writeLine();
                    write(line);
                }
            }
        }

        function writeLinesAndIndent(lineCount: number, writeSpaceIfNotIndenting: boolean) {
            if (lineCount) {
                increaseIndent();
                writeLine(lineCount);
            }
            else if (writeSpaceIfNotIndenting) {
                writeSpace();
            }
        }

        // Helper function to decrease the indent if we previously indented.  Allows multiple
        // previous indent values to be considered at a time.  This also allows caller to just
        // call this once, passing in all their appropriate indent values, instead of needing
        // to call this helper function multiple times.
        function decreaseIndentIf(value1: boolean | number | undefined, value2?: boolean | number) {
            if (value1) {
                decreaseIndent();
            }
            if (value2) {
                decreaseIndent();
            }
        }

        function getLeadingLineTerminatorCount(parentNode: Node | undefined, children: readonly Node[], format: ListFormat): number {
            if (format & ListFormat.PreserveLines || preserveSourceNewlines) {
                if (format & ListFormat.PreferNewLine) {
                    return 1;
                }

                const firstChild = children[0];
                if (firstChild === undefined) {
                    return !parentNode || rangeIsOnSingleLine(parentNode, currentSourceFile!) ? 0 : 1;
                }
                if (firstChild.pos === nextListElementPos) {
                    // If this child starts at the beginning of a list item in a parent list, its leading
                    // line terminators have already been written as the separating line terminators of the
                    // parent list. Example:
                    //
                    // class Foo {
                    //   constructor() {}
                    //   public foo() {}
                    // }
                    //
                    // The outer list is the list of class members, with one line terminator between the
                    // constructor and the method. The constructor is written, the separating line terminator
                    // is written, and then we start emitting the method. Its modifiers ([public]) constitute an inner
                    // list, so we look for its leading line terminators. If we didn't know that we had already
                    // written a newline as part of the parent list, it would appear that we need to write a
                    // leading newline to start the modifiers.
                    return 0;
                }
                if (firstChild.kind === SyntaxKind.JsxText) {
                    // JsxText will be written with its leading whitespace, so don't add more manually.
                    return 0;
                }
                if (parentNode &&
                    !positionIsSynthesized(parentNode.pos) &&
                    !nodeIsSynthesized(firstChild) &&
                    (!firstChild.parent || getOriginalNode(firstChild.parent) === getOriginalNode(parentNode))
                ) {
                    if (preserveSourceNewlines) {
                        return getEffectiveLines(
                            includeComments => getLinesBetweenPositionAndPrecedingNonWhitespaceCharacter(
                                firstChild.pos,
                                parentNode.pos,
                                currentSourceFile!,
                                includeComments));
                    }
                    return rangeStartPositionsAreOnSameLine(parentNode, firstChild, currentSourceFile!) ? 0 : 1;
                }
                if (synthesizedNodeStartsOnNewLine(firstChild, format)) {
                    return 1;
                }
            }
            return format & ListFormat.MultiLine ? 1 : 0;
        }

        function getSeparatingLineTerminatorCount(previousNode: Node | undefined, nextNode: Node, format: ListFormat): number {
            if (format & ListFormat.PreserveLines || preserveSourceNewlines) {
                if (previousNode === undefined || nextNode === undefined) {
                    return 0;
                }
                if (nextNode.kind === SyntaxKind.JsxText) {
                    // JsxText will be written with its leading whitespace, so don't add more manually.
                    return 0;
                }
                else if (!nodeIsSynthesized(previousNode) && !nodeIsSynthesized(nextNode)) {
                    if (preserveSourceNewlines && siblingNodePositionsAreComparable(previousNode, nextNode)) {
                        return getEffectiveLines(
                            includeComments => getLinesBetweenRangeEndAndRangeStart(
                                previousNode,
                                nextNode,
                                currentSourceFile!,
                                includeComments));
                    }
                    // If `preserveSourceNewlines` is `false` we do not intend to preserve the effective lines between the
                    // previous and next node. Instead we naively check whether nodes are on separate lines within the
                    // same node parent. If so, we intend to preserve a single line terminator. This is less precise and
                    // expensive than checking with `preserveSourceNewlines` as above, but the goal is not to preserve the
                    // effective source lines between two sibling nodes.
                    else if (!preserveSourceNewlines && originalNodesHaveSameParent(previousNode, nextNode)) {
                        return rangeEndIsOnSameLineAsRangeStart(previousNode, nextNode, currentSourceFile!) ? 0 : 1;
                    }
                    // If the two nodes are not comparable, add a line terminator based on the format that can indicate
                    // whether new lines are preferred or not.
                    return format & ListFormat.PreferNewLine ? 1 : 0;
                }
                else if (synthesizedNodeStartsOnNewLine(previousNode, format) || synthesizedNodeStartsOnNewLine(nextNode, format)) {
                    return 1;
                }
            }
            else if (getStartsOnNewLine(nextNode)) {
                return 1;
            }
            return format & ListFormat.MultiLine ? 1 : 0;
        }

        function getClosingLineTerminatorCount(parentNode: Node | undefined, children: readonly Node[], format: ListFormat): number {
            if (format & ListFormat.PreserveLines || preserveSourceNewlines) {
                if (format & ListFormat.PreferNewLine) {
                    return 1;
                }

                const lastChild = lastOrUndefined(children);
                if (lastChild === undefined) {
                    return !parentNode || rangeIsOnSingleLine(parentNode, currentSourceFile!) ? 0 : 1;
                }
                if (parentNode && !positionIsSynthesized(parentNode.pos) && !nodeIsSynthesized(lastChild) && (!lastChild.parent || lastChild.parent === parentNode)) {
                    if (preserveSourceNewlines) {
                        const end = isNodeArray(children) && !positionIsSynthesized(children.end) ? children.end : lastChild.end;
                        return getEffectiveLines(
                            includeComments => getLinesBetweenPositionAndNextNonWhitespaceCharacter(
                                end,
                                parentNode.end,
                                currentSourceFile!,
                                includeComments));
                    }
                    return rangeEndPositionsAreOnSameLine(parentNode, lastChild, currentSourceFile!) ? 0 : 1;
                }
                if (synthesizedNodeStartsOnNewLine(lastChild, format)) {
                    return 1;
                }
            }
            if (format & ListFormat.MultiLine && !(format & ListFormat.NoTrailingNewLine)) {
                return 1;
            }
            return 0;
        }

        function getEffectiveLines(getLineDifference: (includeComments: boolean) => number) {
            // If 'preserveSourceNewlines' is disabled, we should never call this function
            // because it could be more expensive than alternative approximations.
            Debug.assert(!!preserveSourceNewlines);
            // We start by measuring the line difference from a position to its adjacent comments,
            // so that this is counted as a one-line difference, not two:
            //
            //   node1;
            //   // NODE2 COMMENT
            //   node2;
            const lines = getLineDifference(/*includeComments*/ true);
            if (lines === 0) {
                // However, if the line difference considering comments was 0, we might have this:
                //
                //   node1; // NODE2 COMMENT
                //   node2;
                //
                // in which case we should be ignoring node2's comment, so this too is counted as
                // a one-line difference, not zero.
                return getLineDifference(/*includeComments*/ false);
            }
            return lines;
        }

        function writeLineSeparatorsAndIndentBefore(node: Node, parent: Node): boolean {
            const leadingNewlines = preserveSourceNewlines && getLeadingLineTerminatorCount(parent, [node], ListFormat.None);
            if (leadingNewlines) {
                writeLinesAndIndent(leadingNewlines, /*writeSpaceIfNotIndenting*/ false);
            }
            return !!leadingNewlines;
        }

        function writeLineSeparatorsAfter(node: Node, parent: Node) {
            const trailingNewlines = preserveSourceNewlines && getClosingLineTerminatorCount(parent, [node], ListFormat.None);
            if (trailingNewlines) {
                writeLine(trailingNewlines);
            }
        }

        function synthesizedNodeStartsOnNewLine(node: Node, format: ListFormat) {
            if (nodeIsSynthesized(node)) {
                const startsOnNewLine = getStartsOnNewLine(node);
                if (startsOnNewLine === undefined) {
                    return (format & ListFormat.PreferNewLine) !== 0;
                }

                return startsOnNewLine;
            }

            return (format & ListFormat.PreferNewLine) !== 0;
        }

        function getLinesBetweenNodes(parent: Node, node1: Node, node2: Node): number {
            if (getEmitFlags(parent) & EmitFlags.NoIndentation) {
                return 0;
            }

            parent = skipSynthesizedParentheses(parent);
            node1 = skipSynthesizedParentheses(node1);
            node2 = skipSynthesizedParentheses(node2);

            // Always use a newline for synthesized code if the synthesizer desires it.
            if (getStartsOnNewLine(node2)) {
                return 1;
            }

            if (!nodeIsSynthesized(parent) && !nodeIsSynthesized(node1) && !nodeIsSynthesized(node2)) {
                if (preserveSourceNewlines) {
                    return getEffectiveLines(
                        includeComments => getLinesBetweenRangeEndAndRangeStart(
                            node1,
                            node2,
                            currentSourceFile!,
                            includeComments));
                }
                return rangeEndIsOnSameLineAsRangeStart(node1, node2, currentSourceFile!) ? 0 : 1;
            }

            return 0;
        }

        function isEmptyBlock(block: BlockLike) {
            return block.statements.length === 0
                && rangeEndIsOnSameLineAsRangeStart(block, block, currentSourceFile!);
        }

        function skipSynthesizedParentheses(node: Node) {
            while (node.kind === SyntaxKind.ParenthesizedExpression && nodeIsSynthesized(node)) {
                node = (node as ParenthesizedExpression).expression;
            }

            return node;
        }

        function getTextOfNode(node: Node, includeTrivia?: boolean): string {
            if (isGeneratedIdentifier(node)) {
                return generateName(node);
            }
            else if ((isIdentifier(node) || isPrivateIdentifier(node)) && (nodeIsSynthesized(node) || !node.parent || !currentSourceFile || (node.parent && currentSourceFile && getSourceFileOfNode(node) !== getOriginalNode(currentSourceFile)))) {
                return idText(node);
            }
            else if (node.kind === SyntaxKind.StringLiteral && (node as StringLiteral).textSourceNode) {
                return getTextOfNode((node as StringLiteral).textSourceNode!, includeTrivia);
            }
            else if (isLiteralExpression(node) && (nodeIsSynthesized(node) || !node.parent)) {
                return node.text;
            }

            return getSourceTextOfNodeFromSourceFile(currentSourceFile!, node, includeTrivia);
        }

        function getLiteralTextOfNode(node: LiteralLikeNode, neverAsciiEscape: boolean | undefined, jsxAttributeEscape: boolean): string {
            if (node.kind === SyntaxKind.StringLiteral && (node as StringLiteral).textSourceNode) {
                const textSourceNode = (node as StringLiteral).textSourceNode!;
                if (isIdentifier(textSourceNode) || isNumericLiteral(textSourceNode)) {
                    const text = isNumericLiteral(textSourceNode) ? textSourceNode.text : getTextOfNode(textSourceNode);
                    return jsxAttributeEscape ? `"${escapeJsxAttributeString(text)}"` :
                        neverAsciiEscape || (getEmitFlags(node) & EmitFlags.NoAsciiEscaping) ? `"${escapeString(text)}"` :
                        `"${escapeNonAsciiString(text)}"`;
                }
                else {
                    return getLiteralTextOfNode(textSourceNode, neverAsciiEscape, jsxAttributeEscape);
                }
            }

            const flags = (neverAsciiEscape ? GetLiteralTextFlags.NeverAsciiEscape : 0)
                | (jsxAttributeEscape ? GetLiteralTextFlags.JsxAttributeEscape : 0)
                | (printerOptions.terminateUnterminatedLiterals ? GetLiteralTextFlags.TerminateUnterminatedLiterals : 0)
                | (printerOptions.target && printerOptions.target === ScriptTarget.ESNext ? GetLiteralTextFlags.AllowNumericSeparator : 0);

            return getLiteralText(node, currentSourceFile!, flags);
        }

        /**
         * Push a new name generation scope.
         */
        function pushNameGenerationScope(node: Node | undefined) {
            if (node && getEmitFlags(node) & EmitFlags.ReuseTempVariableScope) {
                return;
            }
            tempFlagsStack.push(tempFlags);
            tempFlags = 0;
            reservedNamesStack.push(reservedNames);
        }

        /**
         * Pop the current name generation scope.
         */
        function popNameGenerationScope(node: Node | undefined) {
            if (node && getEmitFlags(node) & EmitFlags.ReuseTempVariableScope) {
                return;
            }
            tempFlags = tempFlagsStack.pop()!;
            reservedNames = reservedNamesStack.pop()!;
        }

        function reserveNameInNestedScopes(name: string) {
            if (!reservedNames || reservedNames === lastOrUndefined(reservedNamesStack)) {
                reservedNames = new Set();
            }
            reservedNames.add(name);
        }

        function generateNames(node: Node | undefined) {
            if (!node) return;
            switch (node.kind) {
                case SyntaxKind.Block:
                    forEach((node as Block).statements, generateNames);
                    break;
                case SyntaxKind.LabeledStatement:
                case SyntaxKind.WithStatement:
                case SyntaxKind.DoStatement:
                case SyntaxKind.WhileStatement:
                    generateNames((node as LabeledStatement | WithStatement | DoStatement | WhileStatement).statement);
                    break;
                case SyntaxKind.IfStatement:
                    generateNames((node as IfStatement).thenStatement);
                    generateNames((node as IfStatement).elseStatement);
                    break;
                case SyntaxKind.ForStatement:
                case SyntaxKind.ForOfStatement:
                case SyntaxKind.ForInStatement:
                    generateNames((node as ForStatement | ForInOrOfStatement).initializer);
                    generateNames((node as ForStatement | ForInOrOfStatement).statement);
                    break;
                case SyntaxKind.SwitchStatement:
                    generateNames((node as SwitchStatement).caseBlock);
                    break;
                case SyntaxKind.CaseBlock:
                    forEach((node as CaseBlock).clauses, generateNames);
                    break;
                case SyntaxKind.CaseClause:
                case SyntaxKind.DefaultClause:
                    forEach((node as CaseOrDefaultClause).statements, generateNames);
                    break;
                case SyntaxKind.TryStatement:
                    generateNames((node as TryStatement).tryBlock);
                    generateNames((node as TryStatement).catchClause);
                    generateNames((node as TryStatement).finallyBlock);
                    break;
                case SyntaxKind.CatchClause:
                    generateNames((node as CatchClause).variableDeclaration);
                    generateNames((node as CatchClause).block);
                    break;
                case SyntaxKind.VariableStatement:
                    generateNames((node as VariableStatement).declarationList);
                    break;
                case SyntaxKind.VariableDeclarationList:
                    forEach((node as VariableDeclarationList).declarations, generateNames);
                    break;
                case SyntaxKind.VariableDeclaration:
                case SyntaxKind.Parameter:
                case SyntaxKind.BindingElement:
                case SyntaxKind.ClassDeclaration:
                    generateNameIfNeeded((node as NamedDeclaration).name);
                    break;
                case SyntaxKind.FunctionDeclaration:
                    generateNameIfNeeded((node as FunctionDeclaration).name);
                    if (getEmitFlags(node) & EmitFlags.ReuseTempVariableScope) {
                        forEach((node as FunctionDeclaration).parameters, generateNames);
                        generateNames((node as FunctionDeclaration).body);
                    }
                    break;
                case SyntaxKind.ObjectBindingPattern:
                case SyntaxKind.ArrayBindingPattern:
                    forEach((node as BindingPattern).elements, generateNames);
                    break;
                case SyntaxKind.ImportDeclaration:
                    generateNames((node as ImportDeclaration).importClause);
                    break;
                case SyntaxKind.ImportClause:
                    generateNameIfNeeded((node as ImportClause).name);
                    generateNames((node as ImportClause).namedBindings);
                    break;
                case SyntaxKind.NamespaceImport:
                    generateNameIfNeeded((node as NamespaceImport).name);
                    break;
                case SyntaxKind.NamespaceExport:
                    generateNameIfNeeded((node as NamespaceExport).name);
                    break;
                case SyntaxKind.NamedImports:
                    forEach((node as NamedImports).elements, generateNames);
                    break;
                case SyntaxKind.ImportSpecifier:
                    generateNameIfNeeded((node as ImportSpecifier).propertyName || (node as ImportSpecifier).name);
                    break;
            }
        }

        function generateMemberNames(node: Node | undefined) {
            if (!node) return;
            switch (node.kind) {
                case SyntaxKind.PropertyAssignment:
                case SyntaxKind.ShorthandPropertyAssignment:
                case SyntaxKind.PropertyDeclaration:
                case SyntaxKind.MethodDeclaration:
                case SyntaxKind.GetAccessor:
                case SyntaxKind.SetAccessor:
                    generateNameIfNeeded((node as NamedDeclaration).name);
                    break;
            }
        }

        function generateNameIfNeeded(name: DeclarationName | undefined) {
            if (name) {
                if (isGeneratedIdentifier(name)) {
                    generateName(name);
                }
                else if (isBindingPattern(name)) {
                    generateNames(name);
                }
            }
        }

        /**
         * Generate the text for a generated identifier.
         */
        function generateName(name: GeneratedIdentifier) {
            if ((name.autoGenerateFlags & GeneratedIdentifierFlags.KindMask) === GeneratedIdentifierFlags.Node) {
                // Node names generate unique names based on their original node
                // and are cached based on that node's id.
                return generateNameCached(getNodeForGeneratedName(name), name.autoGenerateFlags);
            }
            else {
                // Auto, Loop, and Unique names are cached based on their unique
                // autoGenerateId.
                const autoGenerateId = name.autoGenerateId!;
                return autoGeneratedIdToGeneratedName[autoGenerateId] || (autoGeneratedIdToGeneratedName[autoGenerateId] = makeName(name));
            }
        }

        function generateNameCached(node: Node, flags?: GeneratedIdentifierFlags) {
            const nodeId = getNodeId(node);
            return nodeIdToGeneratedName[nodeId] || (nodeIdToGeneratedName[nodeId] = generateNameForNode(node, flags));
        }

        /**
         * Returns a value indicating whether a name is unique globally, within the current file,
         * or within the NameGenerator.
         */
        function isUniqueName(name: string): boolean {
            return isFileLevelUniqueName(name)
                && !generatedNames.has(name)
                && !(reservedNames && reservedNames.has(name));
        }

        /**
         * Returns a value indicating whether a name is unique globally or within the current file.
         */
        function isFileLevelUniqueName(name: string) {
            return currentSourceFile ? ts.isFileLevelUniqueName(currentSourceFile, name, hasGlobalName) : true;
        }

        /**
         * Returns a value indicating whether a name is unique within a container.
         */
        function isUniqueLocalName(name: string, container: Node): boolean {
            for (let node = container; isNodeDescendantOf(node, container); node = node.nextContainer!) {
                if (node.locals) {
                    const local = node.locals.get(escapeLeadingUnderscores(name));
                    // We conservatively include alias symbols to cover cases where they're emitted as locals
                    if (local && local.flags & (SymbolFlags.Value | SymbolFlags.ExportValue | SymbolFlags.Alias)) {
                        return false;
                    }
                }
            }
            return true;
        }

        /**
         * Return the next available name in the pattern _a ... _z, _0, _1, ...
         * TempFlags._i or TempFlags._n may be used to express a preference for that dedicated name.
         * Note that names generated by makeTempVariableName and makeUniqueName will never conflict.
         */
        function makeTempVariableName(flags: TempFlags, reservedInNestedScopes?: boolean): string {
            if (flags && !(tempFlags & flags)) {
                const name = flags === TempFlags._i ? "_i" : "_n";
                if (isUniqueName(name)) {
                    tempFlags |= flags;
                    if (reservedInNestedScopes) {
                        reserveNameInNestedScopes(name);
                    }
                    return name;
                }
            }
            while (true) {
                const count = tempFlags & TempFlags.CountMask;
                tempFlags++;
                // Skip over 'i' and 'n'
                if (count !== 8 && count !== 13) {
                    const name = count < 26
                        ? "_" + String.fromCharCode(CharacterCodes.a + count)
                        : "_" + (count - 26);
                    if (isUniqueName(name)) {
                        if (reservedInNestedScopes) {
                            reserveNameInNestedScopes(name);
                        }
                        return name;
                    }
                }
            }
        }

        /**
         * Generate a name that is unique within the current file and doesn't conflict with any names
         * in global scope. The name is formed by adding an '_n' suffix to the specified base name,
         * where n is a positive integer. Note that names generated by makeTempVariableName and
         * makeUniqueName are guaranteed to never conflict.
         * If `optimistic` is set, the first instance will use 'baseName' verbatim instead of 'baseName_1'
         */
        function makeUniqueName(baseName: string, checkFn: (name: string) => boolean = isUniqueName, optimistic?: boolean, scoped?: boolean): string {
            if (optimistic) {
                if (checkFn(baseName)) {
                    if (scoped) {
                        reserveNameInNestedScopes(baseName);
                    }
                    else {
                        generatedNames.add(baseName);
                    }
                    return baseName;
                }
            }
            // Find the first unique 'name_n', where n is a positive number
            if (baseName.charCodeAt(baseName.length - 1) !== CharacterCodes._) {
                baseName += "_";
            }
            let i = 1;
            while (true) {
                const generatedName = baseName + i;
                if (checkFn(generatedName)) {
                    if (scoped) {
                        reserveNameInNestedScopes(generatedName);
                    }
                    else {
                        generatedNames.add(generatedName);
                    }
                    return generatedName;
                }
                i++;
            }
        }

        function makeFileLevelOptimisticUniqueName(name: string) {
            return makeUniqueName(name, isFileLevelUniqueName, /*optimistic*/ true);
        }

        /**
         * Generates a unique name for a ModuleDeclaration or EnumDeclaration.
         */
        function generateNameForModuleOrEnum(node: ModuleDeclaration | EnumDeclaration) {
            const name = getTextOfNode(node.name);
            // Use module/enum name itself if it is unique, otherwise make a unique variation
            return isUniqueLocalName(name, node) ? name : makeUniqueName(name);
        }

        /**
         * Generates a unique name for an ImportDeclaration or ExportDeclaration.
         */
        function generateNameForImportOrExportDeclaration(node: ImportDeclaration | ExportDeclaration) {
            const expr = getExternalModuleName(node)!; // TODO: GH#18217
            const baseName = isStringLiteral(expr) ?
                makeIdentifierFromModuleName(expr.text) : "module";
            return makeUniqueName(baseName);
        }

        /**
         * Generates a unique name for a default export.
         */
        function generateNameForExportDefault() {
            return makeUniqueName("default");
        }

        /**
         * Generates a unique name for a class expression.
         */
        function generateNameForClassExpression() {
            return makeUniqueName("class");
        }

        function generateNameForMethodOrAccessor(node: MethodDeclaration | AccessorDeclaration) {
            if (isIdentifier(node.name)) {
                return generateNameCached(node.name);
            }
            return makeTempVariableName(TempFlags.Auto);
        }

        /**
         * Generates a unique name from a node.
         */
        function generateNameForNode(node: Node, flags?: GeneratedIdentifierFlags): string {
            switch (node.kind) {
                case SyntaxKind.Identifier:
                    return makeUniqueName(
                        getTextOfNode(node),
                        isUniqueName,
                        !!(flags! & GeneratedIdentifierFlags.Optimistic),
                        !!(flags! & GeneratedIdentifierFlags.ReservedInNestedScopes)
                    );
                case SyntaxKind.ModuleDeclaration:
                case SyntaxKind.EnumDeclaration:
                    return generateNameForModuleOrEnum(node as ModuleDeclaration | EnumDeclaration);
                case SyntaxKind.ImportDeclaration:
                case SyntaxKind.ExportDeclaration:
                    return generateNameForImportOrExportDeclaration(node as ImportDeclaration | ExportDeclaration);
                case SyntaxKind.FunctionDeclaration:
                case SyntaxKind.ClassDeclaration:
                case SyntaxKind.ExportAssignment:
                    return generateNameForExportDefault();
                case SyntaxKind.ClassExpression:
                    return generateNameForClassExpression();
                case SyntaxKind.MethodDeclaration:
                case SyntaxKind.GetAccessor:
                case SyntaxKind.SetAccessor:
                    return generateNameForMethodOrAccessor(node as MethodDeclaration | AccessorDeclaration);
                case SyntaxKind.ComputedPropertyName:
                    return makeTempVariableName(TempFlags.Auto, /*reserveInNestedScopes*/ true);
                default:
                    return makeTempVariableName(TempFlags.Auto);
            }
        }

        /**
         * Generates a unique identifier for a node.
         */
        function makeName(name: GeneratedIdentifier) {
            switch (name.autoGenerateFlags & GeneratedIdentifierFlags.KindMask) {
                case GeneratedIdentifierFlags.Auto:
                    return makeTempVariableName(TempFlags.Auto, !!(name.autoGenerateFlags & GeneratedIdentifierFlags.ReservedInNestedScopes));
                case GeneratedIdentifierFlags.Loop:
                    return makeTempVariableName(TempFlags._i, !!(name.autoGenerateFlags & GeneratedIdentifierFlags.ReservedInNestedScopes));
                case GeneratedIdentifierFlags.Unique:
                    return makeUniqueName(
                        idText(name),
                        (name.autoGenerateFlags & GeneratedIdentifierFlags.FileLevel) ? isFileLevelUniqueName : isUniqueName,
                        !!(name.autoGenerateFlags & GeneratedIdentifierFlags.Optimistic),
                        !!(name.autoGenerateFlags & GeneratedIdentifierFlags.ReservedInNestedScopes)
                    );
            }

            return Debug.fail("Unsupported GeneratedIdentifierKind.");
        }

        /**
         * Gets the node from which a name should be generated.
         */
        function getNodeForGeneratedName(name: GeneratedIdentifier) {
            const autoGenerateId = name.autoGenerateId;
            let node = name as Node;
            let original = node.original;
            while (original) {
                node = original;

                // if "node" is a different generated name (having a different
                // "autoGenerateId"), use it and stop traversing.
                if (isIdentifier(node)
                    && !!(node.autoGenerateFlags! & GeneratedIdentifierFlags.Node)
                    && node.autoGenerateId !== autoGenerateId) {
                    break;
                }

                original = node.original;
            }

            // otherwise, return the original node for the source;
            return node;
        }

        // Comments

        function pipelineEmitWithComments(hint: EmitHint, node: Node) {
            const pipelinePhase = getNextPipelinePhase(PipelinePhase.Comments, hint, node);
            const savedContainerPos = containerPos;
            const savedContainerEnd = containerEnd;
            const savedDeclarationListContainerEnd = declarationListContainerEnd;
            emitCommentsBeforeNode(node);
            pipelinePhase(hint, node);
            emitCommentsAfterNode(node, savedContainerPos, savedContainerEnd, savedDeclarationListContainerEnd);
        }

        function emitCommentsBeforeNode(node: Node) {
            const emitFlags = getEmitFlags(node);
            const commentRange = getCommentRange(node);

            // Emit leading comments
            emitLeadingCommentsOfNode(node, emitFlags, commentRange.pos, commentRange.end);
            if (emitFlags & EmitFlags.NoNestedComments) {
                commentsDisabled = true;
            }
        }

        function emitCommentsAfterNode(node: Node, savedContainerPos: number, savedContainerEnd: number, savedDeclarationListContainerEnd: number) {
            const emitFlags = getEmitFlags(node);
            const commentRange = getCommentRange(node);

            // Emit trailing comments
            if (emitFlags & EmitFlags.NoNestedComments) {
                commentsDisabled = false;
            }
            emitTrailingCommentsOfNode(node, emitFlags, commentRange.pos, commentRange.end, savedContainerPos, savedContainerEnd, savedDeclarationListContainerEnd);
            const typeNode = getTypeNode(node);
            if (typeNode) {
                emitTrailingCommentsOfNode(node, emitFlags, typeNode.pos, typeNode.end, savedContainerPos, savedContainerEnd, savedDeclarationListContainerEnd);
            }
        }

        function emitLeadingCommentsOfNode(node: Node, emitFlags: EmitFlags, pos: number, end: number) {
            enterComment();
            hasWrittenComment = false;

            // We have to explicitly check that the node is JsxText because if the compilerOptions.jsx is "preserve" we will not do any transformation.
            // It is expensive to walk entire tree just to set one kind of node to have no comments.
            const skipLeadingComments = pos < 0 || (emitFlags & EmitFlags.NoLeadingComments) !== 0 || node.kind === SyntaxKind.JsxText;
            const skipTrailingComments = end < 0 || (emitFlags & EmitFlags.NoTrailingComments) !== 0 || node.kind === SyntaxKind.JsxText;

            // Save current container state on the stack.
            if ((pos > 0 || end > 0) && pos !== end) {
                // Emit leading comments if the position is not synthesized and the node
                // has not opted out from emitting leading comments.
                if (!skipLeadingComments) {
                    emitLeadingComments(pos, /*isEmittedNode*/ node.kind !== SyntaxKind.NotEmittedStatement);
                }

                if (!skipLeadingComments || (pos >= 0 && (emitFlags & EmitFlags.NoLeadingComments) !== 0)) {
                    // Advance the container position if comments get emitted or if they've been disabled explicitly using NoLeadingComments.
                    containerPos = pos;
                }

                if (!skipTrailingComments || (end >= 0 && (emitFlags & EmitFlags.NoTrailingComments) !== 0)) {
                    // As above.
                    containerEnd = end;

                    // To avoid invalid comment emit in a down-level binding pattern, we
                    // keep track of the last declaration list container's end
                    if (node.kind === SyntaxKind.VariableDeclarationList) {
                        declarationListContainerEnd = end;
                    }
                }
            }
            forEach(getSyntheticLeadingComments(node), emitLeadingSynthesizedComment);
            exitComment();
        }

        function emitTrailingCommentsOfNode(node: Node, emitFlags: EmitFlags, pos: number, end: number, savedContainerPos: number, savedContainerEnd: number, savedDeclarationListContainerEnd: number) {
            enterComment();
            const skipTrailingComments = end < 0 || (emitFlags & EmitFlags.NoTrailingComments) !== 0 || node.kind === SyntaxKind.JsxText;
            forEach(getSyntheticTrailingComments(node), emitTrailingSynthesizedComment);
            if ((pos > 0 || end > 0) && pos !== end) {
                // Restore previous container state.
                containerPos = savedContainerPos;
                containerEnd = savedContainerEnd;
                declarationListContainerEnd = savedDeclarationListContainerEnd;

                // Emit trailing comments if the position is not synthesized and the node
                // has not opted out from emitting leading comments and is an emitted node.
                if (!skipTrailingComments && node.kind !== SyntaxKind.NotEmittedStatement) {
                    emitTrailingComments(end);
                }
            }
            exitComment();
        }

        function emitLeadingSynthesizedComment(comment: SynthesizedComment) {
            if (comment.hasLeadingNewline || comment.kind === SyntaxKind.SingleLineCommentTrivia) {
                writer.writeLine();
            }
            writeSynthesizedComment(comment);
            if (comment.hasTrailingNewLine || comment.kind === SyntaxKind.SingleLineCommentTrivia) {
                writer.writeLine();
            }
            else {
                writer.writeSpace(" ");
            }
        }

        function emitTrailingSynthesizedComment(comment: SynthesizedComment) {
            if (!writer.isAtStartOfLine()) {
                writer.writeSpace(" ");
            }
            writeSynthesizedComment(comment);
            if (comment.hasTrailingNewLine) {
                writer.writeLine();
            }
        }

        function writeSynthesizedComment(comment: SynthesizedComment) {
            const text = formatSynthesizedComment(comment);
            const lineMap = comment.kind === SyntaxKind.MultiLineCommentTrivia ? computeLineStarts(text) : undefined;
            writeCommentRange(text, lineMap!, writer, 0, text.length, newLine);
        }

        function formatSynthesizedComment(comment: SynthesizedComment) {
            return comment.kind === SyntaxKind.MultiLineCommentTrivia
                ? `/*${comment.text}*/`
                : `//${comment.text}`;
        }

        function emitBodyWithDetachedComments(node: Node, detachedRange: TextRange, emitCallback: (node: Node) => void) {
            enterComment();
            const { pos, end } = detachedRange;
            const emitFlags = getEmitFlags(node);
            const skipLeadingComments = pos < 0 || (emitFlags & EmitFlags.NoLeadingComments) !== 0;
            const skipTrailingComments = commentsDisabled || end < 0 || (emitFlags & EmitFlags.NoTrailingComments) !== 0;
            if (!skipLeadingComments) {
                emitDetachedCommentsAndUpdateCommentsInfo(detachedRange);
            }

            exitComment();
            if (emitFlags & EmitFlags.NoNestedComments && !commentsDisabled) {
                commentsDisabled = true;
                emitCallback(node);
                commentsDisabled = false;
            }
            else {
                emitCallback(node);
            }

            enterComment();
            if (!skipTrailingComments) {
                emitLeadingComments(detachedRange.end, /*isEmittedNode*/ true);
                if (hasWrittenComment && !writer.isAtStartOfLine()) {
                    writer.writeLine();
                }
            }
            exitComment();

        }

        function originalNodesHaveSameParent(nodeA: Node, nodeB: Node) {
            nodeA = getOriginalNode(nodeA);
            // For performance, do not call `getOriginalNode` for `nodeB` if `nodeA` doesn't even
            // have a parent node.
            return nodeA.parent && nodeA.parent === getOriginalNode(nodeB).parent;
        }

        function siblingNodePositionsAreComparable(previousNode: Node, nextNode: Node) {
            if (nextNode.pos < previousNode.end) {
                return false;
            }

            previousNode = getOriginalNode(previousNode);
            nextNode = getOriginalNode(nextNode);
            const parent = previousNode.parent;
            if (!parent || parent !== nextNode.parent) {
                return false;
            }

            const parentNodeArray = getContainingNodeArray(previousNode);
            const prevNodeIndex = parentNodeArray?.indexOf(previousNode);
            return prevNodeIndex !== undefined && prevNodeIndex > -1 && parentNodeArray!.indexOf(nextNode) === prevNodeIndex + 1;
        }

        function emitLeadingComments(pos: number, isEmittedNode: boolean) {
            hasWrittenComment = false;

            if (isEmittedNode) {
                if (pos === 0 && currentSourceFile?.isDeclarationFile) {
                    forEachLeadingCommentToEmit(pos, emitNonTripleSlashLeadingComment);
                }
                else {
                    forEachLeadingCommentToEmit(pos, emitLeadingComment);
                }
            }
            else if (pos === 0) {
                // If the node will not be emitted in JS, remove all the comments(normal, pinned and ///) associated with the node,
                // unless it is a triple slash comment at the top of the file.
                // For Example:
                //      /// <reference-path ...>
                //      declare var x;
                //      /// <reference-path ...>
                //      interface F {}
                //  The first /// will NOT be removed while the second one will be removed even though both node will not be emitted
                forEachLeadingCommentToEmit(pos, emitTripleSlashLeadingComment);
            }
        }

        function emitTripleSlashLeadingComment(commentPos: number, commentEnd: number, kind: SyntaxKind, hasTrailingNewLine: boolean, rangePos: number) {
            if (isTripleSlashComment(commentPos, commentEnd)) {
                emitLeadingComment(commentPos, commentEnd, kind, hasTrailingNewLine, rangePos);
            }
        }

        function emitNonTripleSlashLeadingComment(commentPos: number, commentEnd: number, kind: SyntaxKind, hasTrailingNewLine: boolean, rangePos: number) {
            if (!isTripleSlashComment(commentPos, commentEnd)) {
                emitLeadingComment(commentPos, commentEnd, kind, hasTrailingNewLine, rangePos);
            }
        }

        function shouldWriteComment(text: string, pos: number) {
            if (printerOptions.onlyPrintJsDocStyle) {
                return (isJSDocLikeText(text, pos) || isPinnedComment(text, pos));
            }
            return true;
        }

        function emitLeadingComment(commentPos: number, commentEnd: number, kind: SyntaxKind, hasTrailingNewLine: boolean, rangePos: number) {
            if (!shouldWriteComment(currentSourceFile!.text, commentPos)) return;
            if (!hasWrittenComment) {
                emitNewLineBeforeLeadingCommentOfPosition(getCurrentLineMap(), writer, rangePos, commentPos);
                hasWrittenComment = true;
            }

            // Leading comments are emitted at /*leading comment1 */space/*leading comment*/space
            emitPos(commentPos);
            writeCommentRange(currentSourceFile!.text, getCurrentLineMap(), writer, commentPos, commentEnd, newLine);
            emitPos(commentEnd);

            if (hasTrailingNewLine) {
                writer.writeLine();
            }
            else if (kind === SyntaxKind.MultiLineCommentTrivia) {
                writer.writeSpace(" ");
            }
        }

        function emitLeadingCommentsOfPosition(pos: number) {
            if (commentsDisabled || pos === -1) {
                return;
            }

            emitLeadingComments(pos, /*isEmittedNode*/ true);
        }

        function emitTrailingComments(pos: number) {
            forEachTrailingCommentToEmit(pos, emitTrailingComment);
        }

        function emitTrailingComment(commentPos: number, commentEnd: number, _kind: SyntaxKind, hasTrailingNewLine: boolean) {
            if (!shouldWriteComment(currentSourceFile!.text, commentPos)) return;
            // trailing comments are emitted at space/*trailing comment1 */space/*trailing comment2*/
            if (!writer.isAtStartOfLine()) {
                writer.writeSpace(" ");
            }

            emitPos(commentPos);
            writeCommentRange(currentSourceFile!.text, getCurrentLineMap(), writer, commentPos, commentEnd, newLine);
            emitPos(commentEnd);

            if (hasTrailingNewLine) {
                writer.writeLine();
            }
        }

        function emitTrailingCommentsOfPosition(pos: number, prefixSpace?: boolean, forceNoNewline?: boolean) {
            if (commentsDisabled) {
                return;
            }
            enterComment();
            forEachTrailingCommentToEmit(pos, prefixSpace ? emitTrailingComment : forceNoNewline ? emitTrailingCommentOfPositionNoNewline : emitTrailingCommentOfPosition);
            exitComment();
        }

        function emitTrailingCommentOfPositionNoNewline(commentPos: number, commentEnd: number, kind: SyntaxKind) {
            // trailing comments of a position are emitted at /*trailing comment1 */space/*trailing comment*/space

            emitPos(commentPos);
            writeCommentRange(currentSourceFile!.text, getCurrentLineMap(), writer, commentPos, commentEnd, newLine);
            emitPos(commentEnd);

            if (kind === SyntaxKind.SingleLineCommentTrivia) {
                writer.writeLine(); // still write a newline for single-line comments, so closing tokens aren't written on the same line
            }
        }

        function emitTrailingCommentOfPosition(commentPos: number, commentEnd: number, _kind: SyntaxKind, hasTrailingNewLine: boolean) {
            // trailing comments of a position are emitted at /*trailing comment1 */space/*trailing comment*/space

            emitPos(commentPos);
            writeCommentRange(currentSourceFile!.text, getCurrentLineMap(), writer, commentPos, commentEnd, newLine);
            emitPos(commentEnd);

            if (hasTrailingNewLine) {
                writer.writeLine();
            }
            else {
                writer.writeSpace(" ");
            }
        }

        function forEachLeadingCommentToEmit(pos: number, cb: (commentPos: number, commentEnd: number, kind: SyntaxKind, hasTrailingNewLine: boolean, rangePos: number) => void) {
            // Emit the leading comments only if the container's pos doesn't match because the container should take care of emitting these comments
            if (currentSourceFile && (containerPos === -1 || pos !== containerPos)) {
                if (hasDetachedComments(pos)) {
                    forEachLeadingCommentWithoutDetachedComments(cb);
                }
                else {
                    forEachLeadingCommentRange(currentSourceFile.text, pos, cb, /*state*/ pos);
                }
            }
        }

        function forEachTrailingCommentToEmit(end: number, cb: (commentPos: number, commentEnd: number, kind: SyntaxKind, hasTrailingNewLine: boolean) => void) {
            // Emit the trailing comments only if the container's end doesn't match because the container should take care of emitting these comments
            if (currentSourceFile && (containerEnd === -1 || (end !== containerEnd && end !== declarationListContainerEnd))) {
                forEachTrailingCommentRange(currentSourceFile.text, end, cb);
            }
        }

        function hasDetachedComments(pos: number) {
            return detachedCommentsInfo !== undefined && last(detachedCommentsInfo).nodePos === pos;
        }

        function forEachLeadingCommentWithoutDetachedComments(cb: (commentPos: number, commentEnd: number, kind: SyntaxKind, hasTrailingNewLine: boolean, rangePos: number) => void) {
            // get the leading comments from detachedPos
            const pos = last(detachedCommentsInfo!).detachedCommentEndPos;
            if (detachedCommentsInfo!.length - 1) {
                detachedCommentsInfo!.pop();
            }
            else {
                detachedCommentsInfo = undefined;
            }

            forEachLeadingCommentRange(currentSourceFile!.text, pos, cb, /*state*/ pos);
        }

        function emitDetachedCommentsAndUpdateCommentsInfo(range: TextRange) {
            const currentDetachedCommentInfo = emitDetachedComments(currentSourceFile!.text, getCurrentLineMap(), writer, emitComment, range, newLine, commentsDisabled);
            if (currentDetachedCommentInfo) {
                if (detachedCommentsInfo) {
                    detachedCommentsInfo.push(currentDetachedCommentInfo);
                }
                else {
                    detachedCommentsInfo = [currentDetachedCommentInfo];
                }
            }
        }

        function emitComment(text: string, lineMap: number[], writer: EmitTextWriter, commentPos: number, commentEnd: number, newLine: string) {
            if (!shouldWriteComment(currentSourceFile!.text, commentPos)) return;
            emitPos(commentPos);
            writeCommentRange(text, lineMap, writer, commentPos, commentEnd, newLine);
            emitPos(commentEnd);
        }

        /**
         * Determine if the given comment is a triple-slash
         *
         * @return true if the comment is a triple-slash comment else false
         */
        function isTripleSlashComment(commentPos: number, commentEnd: number) {
            return isRecognizedTripleSlashComment(currentSourceFile!.text, commentPos, commentEnd);
        }

        // Source Maps

        function getParsedSourceMap(node: UnparsedSource) {
            if (node.parsedSourceMap === undefined && node.sourceMapText !== undefined) {
                node.parsedSourceMap = tryParseRawSourceMap(node.sourceMapText) || false;
            }
            return node.parsedSourceMap || undefined;
        }

        function pipelineEmitWithSourceMaps(hint: EmitHint, node: Node) {
            const pipelinePhase = getNextPipelinePhase(PipelinePhase.SourceMaps, hint, node);
            emitSourceMapsBeforeNode(node);
            pipelinePhase(hint, node);
            emitSourceMapsAfterNode(node);
        }

        function emitSourceMapsBeforeNode(node: Node) {
            const emitFlags = getEmitFlags(node);
            const sourceMapRange = getSourceMapRange(node);

            // Emit leading sourcemap
            if (isUnparsedNode(node)) {
                Debug.assertIsDefined(node.parent, "UnparsedNodes must have parent pointers");
                const parsed = getParsedSourceMap(node.parent);
                if (parsed && sourceMapGenerator) {
                    sourceMapGenerator.appendSourceMap(
                        writer.getLine(),
                        writer.getColumn(),
                        parsed,
                        node.parent.sourceMapPath!,
                        node.parent.getLineAndCharacterOfPosition(node.pos),
                        node.parent.getLineAndCharacterOfPosition(node.end)
                    );
                }
            }
            else {
                const source = sourceMapRange.source || sourceMapSource;
                if (node.kind !== SyntaxKind.NotEmittedStatement
                    && (emitFlags & EmitFlags.NoLeadingSourceMap) === 0
                    && sourceMapRange.pos >= 0) {
                    emitSourcePos(sourceMapRange.source || sourceMapSource, skipSourceTrivia(source, sourceMapRange.pos));
                }
                if (emitFlags & EmitFlags.NoNestedSourceMaps) {
                    sourceMapsDisabled = true;
                }
            }
        }

        function emitSourceMapsAfterNode(node: Node) {
            const emitFlags = getEmitFlags(node);
            const sourceMapRange = getSourceMapRange(node);

            // Emit trailing sourcemap
            if (!isUnparsedNode(node)) {
                if (emitFlags & EmitFlags.NoNestedSourceMaps) {
                    sourceMapsDisabled = false;
                }
                if (node.kind !== SyntaxKind.NotEmittedStatement
                    && (emitFlags & EmitFlags.NoTrailingSourceMap) === 0
                    && sourceMapRange.end >= 0) {
                    emitSourcePos(sourceMapRange.source || sourceMapSource, sourceMapRange.end);
                }
            }
        }

        /**
         * Skips trivia such as comments and white-space that can be optionally overridden by the source-map source
         */
        function skipSourceTrivia(source: SourceMapSource, pos: number): number {
            return source.skipTrivia ? source.skipTrivia(pos) : skipTrivia(source.text, pos);
        }

        /**
         * Emits a mapping.
         *
         * If the position is synthetic (undefined or a negative value), no mapping will be
         * created.
         *
         * @param pos The position.
         */
        function emitPos(pos: number) {
            if (sourceMapsDisabled || positionIsSynthesized(pos) || isJsonSourceMapSource(sourceMapSource)) {
                return;
            }

            const { line: sourceLine, character: sourceCharacter } = getLineAndCharacterOfPosition(sourceMapSource, pos);
            sourceMapGenerator!.addMapping(
                writer.getLine(),
                writer.getColumn(),
                sourceMapSourceIndex,
                sourceLine,
                sourceCharacter,
                /*nameIndex*/ undefined);
        }

        function emitSourcePos(source: SourceMapSource, pos: number) {
            if (source !== sourceMapSource) {
                const savedSourceMapSource = sourceMapSource;
                const savedSourceMapSourceIndex = sourceMapSourceIndex;
                setSourceMapSource(source);
                emitPos(pos);
                resetSourceMapSource(savedSourceMapSource, savedSourceMapSourceIndex);
            }
            else {
                emitPos(pos);
            }
        }

        /**
         * Emits a token of a node with possible leading and trailing source maps.
         *
         * @param node The node containing the token.
         * @param token The token to emit.
         * @param tokenStartPos The start pos of the token.
         * @param emitCallback The callback used to emit the token.
         */
        function emitTokenWithSourceMap(node: Node | undefined, token: SyntaxKind, writer: (s: string) => void, tokenPos: number, emitCallback: (token: SyntaxKind, writer: (s: string) => void, tokenStartPos: number) => number) {
            if (sourceMapsDisabled || node && isInJsonFile(node)) {
                return emitCallback(token, writer, tokenPos);
            }

            const emitNode = node && node.emitNode;
            const emitFlags = emitNode && emitNode.flags || EmitFlags.None;
            const range = emitNode && emitNode.tokenSourceMapRanges && emitNode.tokenSourceMapRanges[token];
            const source = range && range.source || sourceMapSource;

            tokenPos = skipSourceTrivia(source, range ? range.pos : tokenPos);
            if ((emitFlags & EmitFlags.NoTokenLeadingSourceMaps) === 0 && tokenPos >= 0) {
                emitSourcePos(source, tokenPos);
            }

            tokenPos = emitCallback(token, writer, tokenPos);

            if (range) tokenPos = range.end;
            if ((emitFlags & EmitFlags.NoTokenTrailingSourceMaps) === 0 && tokenPos >= 0) {
                emitSourcePos(source, tokenPos);
            }

            return tokenPos;
        }

        function setSourceMapSource(source: SourceMapSource) {
            if (sourceMapsDisabled) {
                return;
            }

            sourceMapSource = source;

            if (source === mostRecentlyAddedSourceMapSource) {
                // Fast path for when the new source map is the most recently added, in which case
                // we use its captured index without going through the source map generator.
                sourceMapSourceIndex = mostRecentlyAddedSourceMapSourceIndex;
                return;
            }

            if (isJsonSourceMapSource(source)) {
                return;
            }

            sourceMapSourceIndex = sourceMapGenerator!.addSource(source.fileName);
            if (printerOptions.inlineSources) {
                sourceMapGenerator!.setSourceContent(sourceMapSourceIndex, source.text);
            }

            mostRecentlyAddedSourceMapSource = source;
            mostRecentlyAddedSourceMapSourceIndex = sourceMapSourceIndex;
        }

        function resetSourceMapSource(source: SourceMapSource, sourceIndex: number) {
            sourceMapSource = source;
            sourceMapSourceIndex = sourceIndex;
        }

        function isJsonSourceMapSource(sourceFile: SourceMapSource) {
            return fileExtensionIs(sourceFile.fileName, Extension.Json);
        }
    }

    function createBracketsMap() {
        const brackets: string[][] = [];
        brackets[ListFormat.Braces] = ["{", "}"];
        brackets[ListFormat.Parenthesis] = ["(", ")"];
        brackets[ListFormat.AngleBrackets] = ["<", ">"];
        brackets[ListFormat.SquareBrackets] = ["[", "]"];
        return brackets;
    }

    function getOpeningBracket(format: ListFormat) {
        return brackets[format & ListFormat.BracketsMask][0];
    }

    function getClosingBracket(format: ListFormat) {
        return brackets[format & ListFormat.BracketsMask][1];
    }

    // Flags enum to track count of temp variables and a few dedicated names
    const enum TempFlags {
        Auto = 0x00000000,  // No preferred name
        CountMask = 0x0FFFFFFF,  // Temp variable counter
        _i = 0x10000000,  // Use/preference flag for '_i'
    }

    interface OrdinalParentheizerRuleSelector<T extends Node> {
        select(index: number): ((node: T) => T) | undefined;
    }

    type ParenthesizerRule<T extends Node> = (node: T) => T;

    type ParenthesizerRuleOrSelector<T extends Node> = OrdinalParentheizerRuleSelector<T> | ParenthesizerRule<T>;

    function emitListItemNoParenthesizer(node: Node, emit: (node: Node, parenthesizerRule?: ((node: Node) => Node) | undefined) => void, _parenthesizerRule: ParenthesizerRuleOrSelector<Node> | undefined, _index: number) {
        emit(node);
    }

    function emitListItemWithParenthesizerRuleSelector(node: Node, emit: (node: Node, parenthesizerRule?: ((node: Node) => Node) | undefined) => void, parenthesizerRuleSelector: OrdinalParentheizerRuleSelector<Node>, index: number) {
        emit(node, parenthesizerRuleSelector.select(index));
    }

    function emitListItemWithParenthesizerRule(node: Node, emit: (node: Node, parenthesizerRule?: ((node: Node) => Node) | undefined) => void, parenthesizerRule: ParenthesizerRule<Node> | undefined, _index: number) {
        emit(node, parenthesizerRule);
    }

    function getEmitListItem<T extends Node, R extends ParenthesizerRuleOrSelector<T> | undefined>(emit: (node: Node, parenthesizerRule?: ((node: Node) => Node) | undefined) => void, parenthesizerRule: R): (node: Node, emit: (node: Node, parenthesizerRule?: ((node: Node) => Node) | undefined) => void, parenthesizerRule: R, index: number) => void {
        return emit.length === 1 ? emitListItemNoParenthesizer :
            typeof parenthesizerRule === "object" ? emitListItemWithParenthesizerRuleSelector :
            emitListItemWithParenthesizerRule;
    }
}
