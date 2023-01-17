namespace ts {
    const enum Extension {
        Cpp = ".cpp",
        C = ".c",
        Ir = ".ir"
    }

    function getOutputPathsForBundle(options: CompilerOptions): string {
        const nativeFilePath = outFile(options)!;
        return nativeFilePath;
    }

    function getOutputPathsFor(sourceFile: SourceFile | Bundle, host: EmitHost): string {
        const options = host.getCompilerOptions();
        if (sourceFile.kind === SyntaxKind.Bundle) {
            return getOutputPathsForBundle(options);
        }
        else {
            const nativeFilePath = getOwnEmitOutputFilePath(sourceFile.fileName, host, Extension.Cpp);
            return nativeFilePath;
        }
    }

    function getDeclarationNodeFlagsFromSymbol(s: Symbol): NodeFlags {
        return s.valueDeclaration ? getCombinedNodeFlags(s.valueDeclaration) : 0;
    }

    function isConstVariable(s: Symbol): Boolean {
        return (!!(s.flags & SymbolFlags.Variable)) && (!!(getDeclarationNodeFlagsFromSymbol(s) & NodeFlags.Const));
    }

    function getControlFlowContainer(node: Node): Node {
        return findAncestor(node.parent, node =>
            isFunctionLike(node) && !getImmediatelyInvokedFunctionExpression(node) ||
            node.kind === SyntaxKind.ModuleBlock ||
            node.kind === SyntaxKind.SourceFile ||
            node.kind === SyntaxKind.PropertyDeclaration)!;
    }

    /*
    function getAssignmentSource(node: Node): Node | undefined{
        let parent = node.parent;
        while (true) {
            switch (parent.kind) {
                case SyntaxKind.BinaryExpression:
                    const binaryOperator = (parent as BinaryExpression).operatorToken.kind;
                    return isAssignmentOperator(binaryOperator) && (parent as BinaryExpression).left === node ?
                        binaryOperator === SyntaxKind.EqualsToken || isLogicalOrCoalescingAssignmentOperator(binaryOperator) ?
                        (parent as BinaryExpression).right : (parent as BinaryExpression).right :
                        undefined;
                case SyntaxKind.PrefixUnaryExpression:
                case SyntaxKind.PostfixUnaryExpression:
                    const unaryOperator = (parent as PrefixUnaryExpression | PostfixUnaryExpression).operator;
                    return unaryOperator === SyntaxKind.PlusPlusToken || unaryOperator === SyntaxKind.MinusMinusToken ? parent : undefined;
                case SyntaxKind.ForInStatement:
                case SyntaxKind.ForOfStatement:
                    return (parent as ForInOrOfStatement).initializer === node ? parent : undefined;
                case SyntaxKind.ParenthesizedExpression:
                case SyntaxKind.ArrayLiteralExpression:
                case SyntaxKind.SpreadElement:
                case SyntaxKind.NonNullExpression:
                    node = parent;
                    break;
                case SyntaxKind.SpreadAssignment:
                    node = parent.parent;
                    break;
                case SyntaxKind.ShorthandPropertyAssignment:
                    if ((parent as ShorthandPropertyAssignment).name !== node) {
                        return undefined;
                    }
                    node = parent.parent;
                    break;
                case SyntaxKind.PropertyAssignment:
                    if ((parent as ShorthandPropertyAssignment).name === node) {
                        return undefined;
                    }
                    node = parent.parent;
                    break;
                default:
                    return undefined;
            }
            parent = node.parent;
        }
    }
    */

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
     function forEachEmittedFile<T>(
        host: EmitHost, action: (emitFileNames: string, sourceFileOrBundle: SourceFile | Bundle | undefined) => T,
        sourceFilesOrTargetSourceFile?: readonly SourceFile[] | SourceFile) {
        const sourceFiles = isArray(sourceFilesOrTargetSourceFile) ? sourceFilesOrTargetSourceFile : getSourceFilesToEmit(host, sourceFilesOrTargetSourceFile, false);
        const options = host.getCompilerOptions();
        if (outFile(options)) {
            const prepends = host.getPrependNodes();
            if (sourceFiles.length || prepends.length) {
                const bundle = factory.createBundle(sourceFiles, prepends);
                const result = action(getOutputPathsFor(bundle, host), bundle);
                if (result) {
                    return result;
                }
            }
        }
        else {
            for (const sourceFile of sourceFiles) {
                const result = action(getOutputPathsFor(sourceFile, host), sourceFile);
                if (result) {
                    return result;
                }
            }
        }
    }

    export function emitNativeFiles(resolver: EmitResolver, host: EmitHost, targetSourceFile: SourceFile | undefined, { scriptTransformers }: EmitTransformers,): EmitResult {
        const compilerOptions = host.getCompilerOptions();
        const emittedFilesList: string[] | undefined = compilerOptions.listEmittedFiles ? [] : undefined;
        const emitterDiagnostics = createDiagnosticCollection();
        const newLine = getNewLineCharacter(compilerOptions, () => host.getNewLine());
        const writer = createTextWriter(newLine);
        const { enter, exit } = performance.createTimer("printTime", "beforePrint", "afterPrint");
        let emitSkipped = false;
        let exportedModulesFromDeclarationEmit: ExportedModulesFromDeclarationEmit | undefined;
        let bundleBuildInfo: BundleBuildInfo | undefined;

        // Emit each output file
        enter();
        forEachEmittedFile(
            host,
            emitSourceFileOrBundle,
            getSourceFilesToEmit(host, targetSourceFile, false),
        );
        exit();


        return {
            emitSkipped,
            diagnostics: emitterDiagnostics.getDiagnostics(),
            emittedFiles: emittedFilesList,
            sourceMaps: undefined,
            exportedModulesFromDeclarationEmit
        };

        function emitSourceFileOrBundle(nativeFilePath: string, sourceFileOrBundle: SourceFile | Bundle | undefined) {
            tracing?.push(tracing.Phase.Emit, "emitNativeFileOrBundle", { nativeFilePath });
            emitNativeFileOrBundle(sourceFileOrBundle, nativeFilePath);
            tracing?.pop();

            if (!emitSkipped && emittedFilesList) {
                if (nativeFilePath) {
                    emittedFilesList.push(nativeFilePath);
                }
            }

            //function relativeToBuildInfo(path: string) {
            //    return ensurePathIsNonModuleName(getRelativePathFromDirectory(buildInfoDirectory!, path, host.getCanonicalFileName));
            //}
        }

        function emitNativeFileOrBundle(
            sourceFileOrBundle: SourceFile | Bundle | undefined,
            nativeFilePath: string | undefined) {
            if (!sourceFileOrBundle) {
                return;
            }
                // Make sure not to write js file and source map file if any of them cannot be written
            if ((nativeFilePath && host.isEmitBlocked(nativeFilePath)) || compilerOptions.noEmit) {
                emitSkipped = true;
                return;
            }

            // Transform the source files
            const transform = transformNodes(resolver, host, factory, compilerOptions, [sourceFileOrBundle], scriptTransformers, /*allowDtsFiles*/ false);

            const printerOptions: NativePrinterOptions = {
                newLine: compilerOptions.newLine,
                noEmitHelpers: compilerOptions.noEmitHelpers,
                emitNativeCode: compilerOptions.emitQJSCode,
                emitIR: compilerOptions.emitQJSIR,
                module: compilerOptions.module,
                target: compilerOptions.target,
                extendedDiagnostics: compilerOptions.extendedDiagnostics,
                writeBundleFileInfo: !!bundleBuildInfo,
            };

            // Create a printer to print the nodes
            const printer = createNativePrinter(printerOptions, {
                getTypeChecker: resolver.getTypeChecker,
                // resolver hooks
                hasGlobalName: resolver.hasGlobalName,

                // transform hooks
                onEmitNode: transform.emitNodeWithNotification,
                isEmitNotificationEnabled: transform.isEmitNotificationEnabled,
                substituteNode: transform.substituteNode,
            });

            Debug.assert(transform.transformed.length === 1, "Should only see one output from the transform");
            printSourceFileOrBundle(nativeFilePath, transform.transformed[0], printer, compilerOptions);

            transform.dispose();
        }

        interface SourceMapOptions {
            sourceMap?: boolean;
            inlineSourceMap?: boolean;
            inlineSources?: boolean;
            sourceRoot?: string;
            mapRoot?: string;
            extendedDiagnostics?: boolean;
        }

        function printSourceFileOrBundle(nativeFilePath: string | undefined, sourceFileOrBundle: SourceFile | Bundle, printer: Printer, mapOptions: SourceMapOptions) {
            (mapOptions);
            const bundle = sourceFileOrBundle.kind === SyntaxKind.Bundle ? sourceFileOrBundle : undefined;
            const sourceFile = sourceFileOrBundle.kind === SyntaxKind.SourceFile ? sourceFileOrBundle : undefined;
            const sourceFiles = bundle ? bundle.sourceFiles : [sourceFile!];

            if (!nativeFilePath) {
                return;
            }

            if (bundle) {
                printer.writeBundle(bundle, writer, undefined, undefined);
            }
            else {
                printer.writeFile(sourceFile!, writer, undefined, undefined);
            }

            writer.writeLine();

            // Write the output file
            writeFile(host, emitterDiagnostics, nativeFilePath, writer.getText(), !!compilerOptions.emitBOM, sourceFiles);
            // Reset state
            writer.clear();
        }
    }

    interface NativePrinterOptions extends PrinterOptions {
        emitNativeCode?: CompilerOptions["emitNativeCode"];
        emitIR?: CompilerOptions["emitIR"];
    }

    const enum PipelinePhase {
        Notification,
        Substitution,
        Emit,
    }

    function createNativePrinter(printerOptions: NativePrinterOptions = {}, handlers: PrintHandlers = {}): Printer {
        const {
            getTypeChecker,
            //hasGlobalName,
            onEmitNode = noEmitNotification,
            isEmitNotificationEnabled,
            substituteNode = noEmitSubstitution,
            onBeforeEmitNode,
            onAfterEmitNode,
            onBeforeEmitNodeArray,
            onAfterEmitNodeArray,
            //onBeforeEmitToken,
            //onAfterEmitToken
        } = handlers;

        //const extendedDiagnostics = !!printerOptions.extendedDiagnostics;
        const newLine = getNewLineCharacter(printerOptions);
        //const moduleKind = getEmitModuleKind(printerOptions);
        //const bundledHelpers = new Map<string, boolean>();

        let currentSourceFile: SourceFile | undefined;
        //let generatedNames: Set<string>; // Set of names generated by the NameGenerator.
        let tempFlagsStack: TempFlags[]; // Stack of enclosing name generation scopes.
        let tempFlags: TempFlags; // TempFlags for the current name generation scope.
        let reservedNamesStack: Set<string>[]; // Stack of TempFlags reserved in enclosing name generation scopes.
        let reservedNames: Set<string>; // TempFlags to reserve in nested name generation scopes.

        let writer: EmitTextWriter;
        const checker: TypeChecker | undefined = (!!printerOptions.emitNativeCode) ?
                            (!!getTypeChecker ? getTypeChecker() : undefined) : undefined;

        let ownWriter: EmitTextWriter; // Reusable `EmitTextWriter` for basic printing.
        //let write = writeBase;
        //let isOwnFileEmit: boolean;
        const bundleFileInfo = printerOptions.writeBundleFileInfo ? { sections: [] } as BundleFileInfo : undefined;
        //const relativeToBuildInfo = bundleFileInfo ? Debug.checkDefined(printerOptions.relativeToBuildInfo) : undefined;
        //const recordInternalSection = printerOptions.recordInternalSection;
        //let sourceFileTextPos = 0;
        //let sourceFileTextKind: BundleFileTextLikeKind = BundleFileSectionKind.Text;

        let lastSubstitution: Node | undefined;
        let currentParenthesizerRule: ((node: Node) => Node) | undefined;
        //const parenthesizer = factory.parenthesizer;
        //const typeArgumentParenthesizerRuleSelector: OrdinalParentheizerRuleSelector<Node> = {
        //    select: index => index === 0 ? parenthesizer.parenthesizeLeadingTypeArgument : undefined
        //};

        let callGraph: CallGraph;

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
            setWriter(output);
            print(hint, node, sourceFile);
            reset();
            writer = previousWriter;
        }

        function writeList<T extends Node>(format: ListFormat, nodes: NodeArray<T>, sourceFile: SourceFile | undefined, output: EmitTextWriter) {
            const previousWriter = writer;
            setWriter(output);
            if (sourceFile) {
                setSourceFile(sourceFile);
            }
            emitList(/*parentNode*/ undefined, nodes, format);
            reset();
            writer = previousWriter;
        }

        function reset() {
            //generatedNames = new Set();
            tempFlagsStack = [];
            tempFlags = TempFlags.Auto;
            reservedNamesStack = [];
            currentSourceFile = undefined;
            setWriter(/*output*/ undefined);
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

        function setWriter(_writer: EmitTextWriter | undefined) {
            if (_writer && printerOptions.omitTrailingSemicolon) {
                _writer = getTrailingSemicolonDeferringWriter(_writer);
            }

            writer = _writer!; // TODO: GH#18217
        }

        function writeUnparsedSource(unparsed: UnparsedSource, output: EmitTextWriter) {
            const previousWriter = writer;
            setWriter(output);
            print(EmitHint.Unspecified, unparsed, /*sourceFile*/ undefined);
            reset();
            writer = previousWriter;
        }

        function writeFile(sourceFile: SourceFile, output: EmitTextWriter, output2 = undefined, sourceMapGenerator = undefined) {
            (output2);
            (sourceMapGenerator);
            //isOwnFileEmit = true;
            const previousWriter = writer;
            setWriter(output);
            print(EmitHint.SourceFile, sourceFile, sourceFile);
            reset();
            writer = previousWriter;
        }

        function writeBundle(bundle: Bundle, output: EmitTextWriter, output2: EmitTextWriter | undefined, sourceMapGenerator: SourceMapGenerator | undefined) {
            (bundle);
            (output);
            (output2);
            (sourceMapGenerator);
        }

        function setSourceFile(sourceFile: SourceFile | undefined) {
            currentSourceFile = sourceFile;
            (currentSourceFile);
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

            pipelineEmit(hint, node, undefined);
        }

        function pipelineEmit(emitHint: EmitHint, node: Node, parenthesizerRule?: (node: Node) => Node) {
            currentParenthesizerRule = parenthesizerRule;
            const pipelinePhase = getPipelinePhase(PipelinePhase.Notification, emitHint, node);
            pipelinePhase(emitHint, node);
            currentParenthesizerRule = undefined;
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

        function pipelineEmitWithSubstitution(hint: EmitHint, node: Node) {
            const pipelinePhase = getNextPipelinePhase(PipelinePhase.Substitution, hint, node);
            Debug.assertIsDefined(lastSubstitution);
            node = lastSubstitution;
            lastSubstitution = undefined;
            pipelinePhase(hint, node);
        }

        function pipelineEmitWithHint(hint: EmitHint, node: Node): void {
            onBeforeEmitNode?.(node);
            pipelineEmitWithHintWorker(hint, node);
            onAfterEmitNode?.(node);
            // clear the parenthesizer rule as we ascend
            currentParenthesizerRule = undefined;
        }

        function pipelineEmitWithHintWorker(hint: EmitHint, node: Node): void {
            if (hint === EmitHint.SourceFile) return emitSourceFile(cast(node, isSourceFile));
            //if (hint === EmitHint.IdentifierName) return emitIdentifier(cast(node, isIdentifier));
            //if (hint === EmitHint.MappedTypeParameter) return emitMappedTypeParameter(cast(node, isTypeParameterDeclaration));
            //if (hint === EmitHint.EmbeddedStatement) {
            //    Debug.assertNode(node, isEmptyStatement);
            //    return emitEmptyStatement(/*isEmbeddedStatement*/ true);
            //}
        }

        function emitSourceFile(node: SourceFile) {
            emitSourceFileWorker(node);
        }

        function emitSourceFileWorker(node: SourceFile) {
            pushNameGenerationScope(node);

            //const statements = node.statements;
            //const index = findIndex(statements, statement => !isPrologueDirective(statement));
            //emitList(node, statements, ListFormat.MultiLine, /*parenthesizerRule*/ undefined, index === -1 ? statements.length : index);
            buildSourceFile(node);

            popNameGenerationScope(node);
        }

        interface Canonicalizer {
            getCanonicalizedIR(): HIR;
        }

        function createCanonicalizer(getNextIRID: () => number, ir: HIR): Canonicalizer {
            let canonicalizedIR: HIR = ir;
            const nextIRID = getNextIRID;

            const ConstantIRCtor: new (id: number, type: TSValType) => ConstantIR = createConstantIRCtor();
            //const LocalIRCtor: new (id: number, type: TSValType | undefined, localIndex: number, val: HIR | undefined, isReceiver: Boolean) => LocalIR = createLocalIRCtor();
            //const PhiIRCtor: new (id: number, localIndex: number) => PhiIR = createPhiIRCtor();
            //const ReturnIRCtor: new (id: number, val: HIR | undefined) => ReturnIR = createReturnIRCtor();
            //const ArithmeticOPIRCtor: new (id: number, code: SyntaxKind, lhs: HIR, rhs: HIR) => ArithmeticOPIR = createArithmeticOPIRCtor();

            canonicalize(ir);

            return {
                getCanonicalizedIR,
            };

            function getCanonicalizedIR() {
                return canonicalizedIR;
            }

            function canonicalize(ir: HIR) {
                switch (ir.op) {
                    case OpKind.ArithmeticOP:
                    case OpKind.Op2:
                        canonlizeOp2(ir as Op2IR);
                        break;
                    default:
                        break;
                }
            }

            function canonlizeOp2(ir: Op2IR) {
                if (ir.lhs === ir.rhs) {

                }

                if (!ir.lhs.valType) {
                    return;
                }

                if (!ir.rhs.valType) {
                    return;
                }

                if (ir.lhs.valType.isConstant() && ir.rhs.valType.isConstant()) {
                    switch (ir.lhs.valType.type) {
                        case TSType.NumberType: {
                            const lhs = ir.lhs.valType.val as number;
                            const rhs = ir.rhs.valType.val as number;
                            switch (ir.code) {
                                case SyntaxKind.PlusToken:
                                    setNumberConstant(lhs + rhs);
                                    break;
                                default:
                                    break;
                            }
                            break;
                        }
                        default:
                            break;
                    }
                }
            }

            function setNumberConstant(val: number) {
                canonicalizedIR = new ConstantIRCtor(nextIRID(), newConstantType(TSType.NumberType, val));
            }
        }

        interface ValueMap {
            reset(): void;
            findAndInsert(ir: HIR): HIR;
        }

        function createValueMap(): ValueMap {
            interface ValueEntry {
                ir: HIR
                next: ValueEntry | undefined;
            }
            const entries: ESMap<number, ValueEntry> = new Map();

            function reset() {
                entries.clear();
            }

            function findAndInsert(ir: HIR): HIR {
                const hashVal = ir.hash();
                if (hashVal === 0) {
                    return ir;
                }
                const findedEntry = entries.get(hashVal);
                if (!!findedEntry) {
                    let curEntry: ValueEntry | undefined = findedEntry;
                    while (!!curEntry) {
                        if (ir.isEqual(curEntry.ir)) {
                            return curEntry.ir;
                        }
                        else {
                            curEntry = curEntry.next;
                        }
                    }

                    const entry: ValueEntry = {
                        ir,
                        next: findedEntry.next,
                    };

                    findedEntry.next = entry;

                    return ir;
                }
                else {
                    const entry: ValueEntry = {
                        ir,
                        next: undefined,
                    };
                    entries.set(hashVal, entry);
                    return ir;
                }
            }

            return {
                reset,
                findAndInsert,
            };
        }

        interface HIRCompiler {
            newBBlock(tsBlock: TSBlock, node: Node | undefined, pred: BasicBlock | undefined): BasicBlock;
            addBBPred(bb: BasicBlock, pred: BasicBlock): void;
            markBBLocalStore(node: Node): void;
            clearBBSuccs(bb: BasicBlock): void;
            getBBlockCount(): number;
            getCurBBlock(): BasicBlock | undefined;
            setCurBBlock(bb: BasicBlock | undefined): void;
            resetCurBBlock(): void;
            enterTSBlock(node: Node): TSBlock;
            exitTSBlock(): void;
            getCurTSBlock(): TSBlock | undefined;
            getCurFuncTSBlock(): TSBlock | undefined;
            getLastLoopTSBlock(): TSBlock | undefined;
            getName(tsBlock: TSBlock, node: Node | undefined): string;
            dumpBBGraph(): void;
            buildBBInFunction(node: Node): void;
            fillBBInFunction(node: Node): void;
            simplifyBB(): void;
            markLoops(): void;
            getNextIRId(): number;
        }

        const enum BlockFlags {
            NO_FLAG = 0,
            STD_ENTRY_FLAG = 1 << 0,
            PARSE_LOOP_HEADER_FLAG = 1 << 1,
            VISTED_FLAG = 1 << 2,
            IS_ON_WORK_LIST = 1 << 3,
        }

        interface VarDesc {
            index: number;
            kind: VarKind;
            name: string;
            type: TSType;
            subscript: number;
            container: Node;
            symbol: Symbol;
        }

        interface CompileState {
            valueStack: HIR[];
            locals: (HIR | undefined)[];
        }

        interface BasicBlock {
            blockId: number;
            name: string;
            flags: BlockFlags;
            tsBlock: TSBlock;
            node: Node | undefined;
            preds: Set<BasicBlock>;
            succs: Set<BasicBlock>;
            depthNumber: number;
            storeToLocals: Boolean[];
            storedLocalsInfo: (Symbol | undefined)[]; // for dump
            state: CompileState | undefined;
            begin: HIR | undefined;
        }

        interface TSBlock {
            blockId: number; //for debug use, 0 for outmost block
            kind: SyntaxKind;
            reachable: boolean;
            entryBlock: BasicBlock | undefined;
            elseBlock: BasicBlock | undefined;
            endBlock: BasicBlock | undefined;
        }

        interface CallGraph {
            addFunc(node: Node): void;
            exitFunc(): void;
            addCall(node: Node): void;
            initLocals(node: Node): void;
            markClosureVarStore(node: Node): void;
            buildBBForAllFuncs(): void;
            dump(): void;
        }

        function newCallGraph(): CallGraph {
            interface CallGraphFunc {
                astNode: Node;
                compiler: HIRCompiler | undefined;
                callees: Set<CallGraphFunc>;
                callers: Set<CallGraphFunc>;
                storeToLocals: Boolean[];
            }

            const funcs: ESMap<Node, CallGraphFunc> = new Map();
            let curFunc: CallGraphFunc;

            return {
                addFunc,
                exitFunc,
                addCall,
                initLocals,
                markClosureVarStore,
                buildBBForAllFuncs,
                dump: dumpCallGraph,
            };

            function buildBBForAllFuncs() {
                funcs.forEach((func, _) => {
                    const hirCompiler = newCompiler(func.astNode);
                    setCompiler(func, hirCompiler);
                    hirCompiler.buildBBInFunction(func.astNode);
                    hirCompiler.fillBBInFunction(func.astNode);
                });
            }

            function setCompiler(func: CallGraphFunc, compiler: HIRCompiler) {
                func.compiler = compiler;
            }

            function initLocals(node: Node) {
                initStoreToLocals(curFunc, node);
            }

            function markCallerClosureVarStore(func: CallGraphFunc, newCaller: CallGraphFunc | undefined) {
                if (func.astNode.kind !== SyntaxKind.FunctionDeclaration) {
                    return;
                }
                const funcContainer = func.astNode as FunctionDeclaration;
                if (!funcContainer.closureVars) {
                    return;
                }
                const closurVarStart = func.storeToLocals.length - funcContainer.closureVars.length;
                func.callers.forEach((caller) => {
                    if (!!newCaller && caller !== newCaller) {
                        return;
                    }

                    let changed = false;
                    func.storeToLocals.forEach((hasWrite, i) => {
                        if (caller.astNode.kind !== SyntaxKind.FunctionDeclaration) {
                            return;
                        }

                        if (i < closurVarStart) {
                            return;
                        }

                        if (!hasWrite) {
                            return;
                        }

                        const symbol = funcContainer.closureVars[i - closurVarStart].symbol;
                        const callerFuncDecl = caller.astNode as FunctionDeclaration;
                        if (!callerFuncDecl.closureVars) {
                            return;
                        }
                        const callerCvStart = caller.storeToLocals.length - callerFuncDecl.closureVars.length;
                        for (let l = 0; l < callerFuncDecl.closureVars.length; l ++) {
                            const cv = callerFuncDecl.closureVars[l];
                            if (symbol === cv.symbol && !caller.storeToLocals[callerCvStart + l]) {
                                caller.storeToLocals[callerCvStart + l] = true;
                                changed = true;
                                break;
                            }
                        }
                    });

                    if (!changed) {
                        return;
                    }

                    markCallerClosureVarStore(caller, undefined);
                });
            }

            function markClosureVarStore(node: Node) {
                const symbol = checker!.getSymbolAtLocation(node);
                if (!symbol) {
                    return;
                }

                if (!symbol.stackIndex) {
                    return;
                }

                const declaration = symbol.valueDeclaration;
                if (!declaration) {
                    return;
                }
                const declarationContainer = getControlFlowContainer(declaration);
                Debug.assert(declarationContainer.kind === SyntaxKind.FunctionDeclaration ||
                    declarationContainer.kind === SyntaxKind.SourceFile);

                const flowContainer = getControlFlowContainer(node);
                Debug.assert(flowContainer === getParseTreeNode(curFunc.astNode));
                if (declarationContainer !== flowContainer) {
                    if (flowContainer.kind !== SyntaxKind.FunctionDeclaration) {
                        return;
                    }
                    const funcContainer = flowContainer as FunctionDeclaration;
                    if (!funcContainer.closureVars) {
                        return;
                    }

                    for (let i = 0; i < funcContainer.closureVars.length; i++) {
                        const localsId = curFunc.storeToLocals.length - funcContainer.closureVars.length - i;
                        if (funcContainer.closureVars[i].symbol === symbol
                            && !curFunc.storeToLocals[localsId]) {
                            curFunc.storeToLocals[localsId] = true;
                        }
                    }
                }
            }

            function initStoreToLocals(func: CallGraphFunc, node: Node) {
                const originNode = getParseTreeNode(node);
                if (!originNode) {
                    return;
                }

                if (!originNode.locals) {
                    return;
                }

                originNode.locals.forEach((symbol, _) => {
                    if (isConstVariable(symbol)) {
                        func.storeToLocals[symbol.stackIndex!] = false;
                    }
                    else if (symbol.flags & SymbolFlags.Function) {
                        func.storeToLocals[symbol.stackIndex!] = false;
                    }
                });

                for (let i = originNode.locals.size; i < func.storeToLocals.length; i ++) {
                    func.storeToLocals[i] = false;
                }
            }

            function initFuncStoreToLocals(func: CallGraphFunc) {
                // implicitly means all variables will be wrote unless they are declared as const variable.
                func.storeToLocals.fill(true);
            }

            function addFunc(node: Node) {
                const originNode = getParseTreeNode(node);
                if (!originNode) {
                    return;
                }

                let localsCount = originNode.locals ? originNode.locals.size : 0;
                if (node.kind === SyntaxKind.FunctionDeclaration) {
                    const funcDecl = originNode as FunctionDeclaration;
                    localsCount += funcDecl.closureVars ? funcDecl.closureVars.length : 0;
                }

                if (funcs.has(originNode)) {
                    curFunc = funcs.get(originNode)!;
                    curFunc.storeToLocals = new Array(localsCount);
                    initFuncStoreToLocals(curFunc);
                    return;
                }

                const func: CallGraphFunc = {
                    astNode: node,
                    compiler: undefined,
                    callees: new Set(),
                    callers: new Set(),
                    storeToLocals: new Array(localsCount),
                };

                initFuncStoreToLocals(func);
                funcs.set(originNode, func);

                curFunc = func;
            }

            function exitFunc() {
                const node = curFunc.astNode;
                Debug.assert(node.kind === SyntaxKind.FunctionDeclaration);

                const originNode = getParseTreeNode(node);
                if (!originNode) {
                    return;
                }
                const parentFunc = getControlFlowContainer(originNode);
                Debug.assert(!!funcs.has(parentFunc));

                markCallerClosureVarStore(curFunc, undefined);

                curFunc = funcs.get(parentFunc)!;

            }

            function isContainedByFunction(func: Node, node: Node): boolean {
                const originNode = getParseTreeNode(node);
                if (!originNode) {
                    return false;
                }

                let curNode = originNode;
                while (1) {
                    const decl = getControlFlowContainer(curNode);
                    if (!decl) {
                        return false;
                    }

                    if (decl === func) {
                        return true;
                    }
                    curNode = decl;
                }

                return false;
            }

            // currently, we wouldn't consider import functions and builtin functions.
            // will deal with them later.
            function addCall(node: CallExpression) {
                const funcType = checker!.getTypeAtLocation(node);
                Debug.assert(!!funcType.symbol);
                Debug.assert(!!funcType.symbol.declarations);

                const funcDecl = funcType.symbol.declarations[0];
                let notLocalFunc = false;
                if (!isContainedByFunction(curFunc.astNode, funcDecl)) {
                    notLocalFunc = true;
                }

                Debug.assert(funcDecl.kind === SyntaxKind.FunctionDeclaration);

                let callee: CallGraphFunc;
                let existedCallee = false;
                if (!funcs.has(funcDecl)) {
                    const func: CallGraphFunc = {
                        astNode: funcDecl,
                        compiler: undefined,
                        callees: new Set(),
                        callers: new Set(),
                        storeToLocals: [],
                    };

                    if (notLocalFunc) {
                        func.storeToLocals.fill(true);
                    }

                    funcs.set(funcDecl, func);
                    callee = func;
                }
                else {
                    // already func decl exists.
                    callee = funcs.get(funcDecl)!;
                    existedCallee = true;
                }

                curFunc.callees.add(callee);
                callee.callers.add(curFunc);


                if (!existedCallee) {
                    return;
                }

                markCallerClosureVarStore(callee, curFunc);
            }

            function dumpCallGraph() {
                funcs.forEach((func, node) => {
                    let funcName = "";
                    if (node.kind === SyntaxKind.SourceFile) {
                        funcName = (node as SourceFile).fileName;
                    }
                    else {
                        const funcNode = node as FunctionDeclaration;
                        funcName = funcNode.name ? getTextOfNode(funcNode.name, /*includeTrivia*/ false) : "anonymous function";
                    }
                    Debug.log("---------------------------------------------");
                    let calleesName = "";
                    func.callees.forEach((callee) => {
                        const funcNode = callee.astNode as FunctionDeclaration;
                        const calleeName = funcNode.name ? getTextOfNode(funcNode.name, /*includeTrivia*/ false) : "anonymous function";
                        calleesName += calleeName + " ";
                    });
                    if (!!calleesName.length) {
                        Debug.log(funcName + " ===invoke==> " + calleesName);
                    }
                    else {
                        Debug.log(funcName + " is a leaf function.");
                    }

                    let closureVars = "";
                    func.storeToLocals.forEach((val, index) => {
                        if (node.kind === SyntaxKind.SourceFile) {
                            return;
                        }

                        const funcNode = getParseTreeNode(node) as FunctionDeclaration;
                        if (index < funcNode.localsCount) {
                            return;
                        }

                        const cvIndex = func.storeToLocals.length - funcNode.closureVars.length - index;
                        if (val) {
                            closureVars += funcNode.closureVars[cvIndex].name + " ";
                        }
                    });

                    if (!!closureVars.length) {
                        Debug.log("updated closure var: " + closureVars);
                    }

                    Debug.log("---------------------------------------------");
                });
            }
        }

        function makeBBlock(id: number, tsBlock: TSBlock, node: Node | undefined, pred: BasicBlock | undefined, name: string): BasicBlock {
            const bb: BasicBlock = {
                blockId: id,
                name,
                flags: BlockFlags.NO_FLAG,
                tsBlock,
                node,
                preds: new Set(),
                succs: new Set(),
                depthNumber: 0,
                storeToLocals: [],
                storedLocalsInfo: [],
                state: undefined,
                begin: undefined
            };

            if (pred) {
                pred.succs.add(bb);
                bb.preds.add(pred);
            }

            return bb;
        }

        function setBBDepth(bb: BasicBlock, depth: number) {
            bb.depthNumber = depth;
        }

        function resetBBLocalsArray(bb: BasicBlock, count: number) {
            if (count <= 0) {
                return;
            }

            bb.storeToLocals = new Array(count);
            bb.storeToLocals.fill(false);
            bb.storedLocalsInfo.fill(undefined);
        }

        const enum TSType {
            NumberType,
            NumberConstantType,
            StringType,
            StringConstantType,
            ObjectType,
            ObjectConstantType,
            FunctionType,
            MethodType,
            VoidType,
            AnyType,
        }

        interface TSValType {
            type: TSType;
            val: number | string | object | undefined;

            isConstant: () => Boolean;
        }

        function newConstantType(type: TSType, val: number | string | object | undefined): TSValType {
            return {
                type,
                val,
                isConstant
            };

            function isConstant(): Boolean {
                return true;
            }
        }

        const enum OpKind {
            Local,
            Constant,
            Phi,
            Return,
            Op2,
            ArithmeticOP,
        }

        const enum VarKind {
            LocalVar,
            GlobalVar,
            ModuleVar,
            ClosureVar,
            Unknown,
        }

        const enum HIRFlags {
            LinkedInBB = 1 << 0,
        }
        interface HIR {
            id: number;
            op: OpKind;
            flags: HIRFlags;
            valType: TSValType | undefined,
            bb: BasicBlock | undefined;
            useCnt: number;
            sub: HIR | undefined;
            next: HIR | undefined;
            hash(): number;
            isEqual(ir: HIR): Boolean;
        }

        interface LocalIR extends HIR {
            localIndex: number;
            isReceiver: Boolean;
        }

        interface ConstantIR extends HIR {

        }

        interface PhiIR extends HIR {
            localIndex: number;
        }

        interface ReturnIR extends HIR {
        }

        interface Op2IR extends HIR {
            code: SyntaxKind;
            lhs: HIR;
            rhs: HIR;
        }

        interface ArithmeticOPIR extends Op2IR {

        }


        function LocalIR(this: Mutable<LocalIR>, id: number, type: TSValType, localIndex: number, val: HIR | undefined, isReceiver = false) {
            this.id = id;
            this.op = OpKind.Local;
            this.valType = type;
            this.bb = undefined;
            this.useCnt = 0;
            this.sub = val;
            this.next = undefined;
            this.localIndex = localIndex;
            this.isReceiver = isReceiver;
        }

        function createLocalIRCtor(): new (id: number, type: TSValType, localIndex: number, val: HIR | undefined, isReceiver: Boolean) => LocalIR {
            return LocalIR as any;
        }

        function ConstantIR(this: Mutable<ConstantIR>, id: number, type: TSValType) {
            this.id = id;
            this.op = OpKind.Constant;
            this.valType = type;
            this.bb = undefined;
            this.useCnt = 0;
            this.sub = undefined;
            this.next = undefined;
            this.hash = () => {
                let hashval: number = type.type;
                switch (type.type) {
                    case TSType.NumberType:
                        hashval =(hashval << 7) ^ (type.val as number);
                        break;
                    default:
                        break;
                }
                return hashval;
            };
            this.isEqual = (ir) => {
                if (this.op !== ir.op) {
                    return false;
                }

                if (this.valType!.type !== ir.valType!.type) {
                    return false;
                }

                if (this.valType!.val !== ir.valType!.val) {
                    return false;
                }
                return true;
            };
        }

        function createConstantIRCtor(): new (id: number, type: TSValType) => ConstantIR {
            return ConstantIR as any;
        }

        function PhiIR(this: Mutable<PhiIR>, id: number, localIndex: number) {
            this.id = id;
            this.op = OpKind.Phi;
            this.localIndex = localIndex;
            this.bb = undefined;
            this.useCnt = 0;
            this.sub = undefined;
            this.next = undefined;
        }

        function createPhiIRCtor(): new (id: number, localIndex: number) => PhiIR {
            return PhiIR as any;
        }

        function ReturnIR(this: Mutable<ReturnIR>, id: number, val: HIR | undefined) {
            this.id = id;
            this.op = OpKind.Return;
            this.bb = undefined;
            this.useCnt = 0;
            this.sub = val;
            this.next = undefined;
            this.hash = () => {
                return 0;
            };
        }

        function createReturnIRCtor(): new (id: number, val: HIR | undefined) => ReturnIR {
            return ReturnIR as any;
        }

        function getIRSubVal(ir: HIR): HIR {
            let cur = ir;
            while (1) {
                const sub = cur.sub;
                if (!sub) {
                    break;
                }
                else {
                    cur = sub;
                }
            }
            return cur;
        }

        function ArithmeticOPIR(this: Mutable<ArithmeticOPIR>, id: number, code: SyntaxKind, lhs: HIR, rhs: HIR) {
            this.id = id;
            this.op = OpKind.ArithmeticOP;
            this.bb = undefined;
            this.useCnt = 0;
            this.sub = undefined;
            this.next = undefined;
            this.code = code;
            this.lhs = lhs;
            this.rhs = rhs;
            this.hash = () => {
                let hashval: number = this.code;
                const x = getIRSubVal(this.lhs);
                const y = getIRSubVal(this.rhs);

                hashval = (hashval << 7) ^ (x.hash());
                hashval = (hashval << 7) ^ (y.hash());

                return hashval;
            };
            this.isEqual = (ir) => {
                if (this.op !== ir.op) {
                    return false;
                }

                const arithIR = ir as ArithmeticOPIR;

                if (this.code !== arithIR.code) {
                    return false;
                }

                if (this.lhs !== arithIR.lhs) {
                    return false;
                }

                if (this.rhs !== arithIR.rhs) {
                    return false;
                }
                return true;
            };
        }

        function createArithmeticOPIRCtor(): new (id: number, code: SyntaxKind, lhs: HIR, rhs: HIR) => ArithmeticOPIR {
            return ArithmeticOPIR as any;
        }

        const enum CompileTargetKind {
            File,
            Module,
            Function,
        }

        function newCompiler(func: Node): HIRCompiler {
            const curFunc: Node = func;
            let nextBBlockId = 0;
            let nextTSBlockId = 0;
            let blocks: BasicBlock[] = [];
            let curBBlock: BasicBlock | undefined;
            const TSBlockStack: TSBlock[] = [];
            let localsCount = 0;
            //let closureVarsCount = 0;
            let requestPhi: Boolean[] = [];
            let activeBB: Boolean[];
            let visitedBB: Boolean[];
            let loopMap: number[];
            let nextLoopId = 0;
            let nextBlockNum = 0;

            // function property
            let targetKind: CompileTargetKind = CompileTargetKind.Function;

            //IR related
            const workList: BasicBlock[] = [];
            let valueMap: ValueMap;
            let curState: CompileState | undefined;
            let lastBB: BasicBlock | undefined;

            const enum IterateState {
                IterateBegin,
                IterateProcessing,
                IterateMeetBranch,
            }

            let iterateState: IterateState;

            let IRId = 0;
            let lastIR: HIR | undefined;
            const ConstantIRCtor: new (id: number, type: TSValType) => ConstantIR = createConstantIRCtor();
            const LocalIRCtor: new (id: number, type: TSValType | undefined, localIndex: number, val: HIR | undefined, isReceiver: Boolean) => LocalIR = createLocalIRCtor();
            const PhiIRCtor: new (id: number, localIndex: number) => PhiIR = createPhiIRCtor();
            const ReturnIRCtor: new (id: number, val: HIR | undefined) => ReturnIR = createReturnIRCtor();
            const ArithmeticOPIRCtor: new (id: number, code: SyntaxKind, lhs: HIR, rhs: HIR) => ArithmeticOPIR = createArithmeticOPIRCtor();

            const fillIRBinaryExpression = createFillIRBinaryExpression();

            // entry block
            //enterTSBlock(func);
            if (func.kind === SyntaxKind.FunctionDeclaration) {
                // initial as function locals count + closure vars count,
                // which is from binder, where we summed up all local vars and closure vars.
                // later, the sum process should be moved from binder.
                const funcDecl = getParseTreeNode(func) as FunctionDeclaration;
                const cvNum = funcDecl.closureVars ? funcDecl.closureVars.length : 0;
                localsCount = funcDecl.localsCount + cvNum;
                requestPhi = new Array(localsCount);
                requestPhi.fill(false);
            }
            else if (func.kind === SyntaxKind.SourceFile) {
                const file = func as SourceFile;
                if (!!file.locals) {
                    localsCount = file.locals.size;
                }

                targetKind = CompileTargetKind.File;
            }

            return {
                newBBlock,
                addBBPred,
                markBBLocalStore,
                clearBBSuccs,
                getBBlockCount,
                getCurBBlock,
                setCurBBlock,
                resetCurBBlock,
                enterTSBlock,
                exitTSBlock,
                getCurTSBlock,
                getCurFuncTSBlock,
                getLastLoopTSBlock,
                getName,
                dumpBBGraph,
                buildBBInFunction,
                fillBBInFunction,
                simplifyBB,
                markLoops,
                getNextIRId,
            };

            function storeLocal(state: CompileState, varDesc: VarDesc, val: HIR) {
                Debug.assert(varDesc.type === val.valType!.type);
                state.locals[varDesc.index] = val;
            }

            function pushStackValue(state: CompileState, ir: HIR) {
                state.valueStack.push(ir);
            }

            function popStackValue(state: CompileState, type: TSType | undefined): HIR | undefined {
                if (!state.valueStack.length) {
                    return undefined;
                }

                Debug.assert(!type || type === state.valueStack[state.valueStack.length - 1].valType!.type);
                return state.valueStack.pop();
            }

            /*
            function mergeState(bb: BasicBlock, newState: CompileState): Boolean {
                if (!bb.state) {
                    if (bb.flags & BlockFlags.VISTED_FLAG) {
                        return false;
                    }

                    bb.state = newState;
                    return true;
                }
                else {
                    return true;
                }
            }

            function getMaxTopoOrderBlock(): BasicBlock {
                let maxTopoBB: BasicBlock = blocks[0];
                blocks.forEach((bb) => {
                    if (bb.depthNumber > maxTopoBB.depthNumber) {
                        maxTopoBB = bb;
                    }
                });
                return maxTopoBB;
            }
            */

            function fillBBInFunction() {
                const startBlock = blocks[0];
                const initialState =  {
                    locals: new Array(localsCount),
                    valueStack: []
                };
                initialState.locals.fill(undefined);

                valueMap = createValueMap();
                //mergeState(startBlock, initialState);
                startBlock.state = initialState;
                workList.push(startBlock);
                startBlock.flags &= BlockFlags.IS_ON_WORK_LIST;

                iterateBB();
            }

            function iterateBB() {
                let bb = workList.pop();
                while (!!bb) {
                    if (!(bb.flags & BlockFlags.VISTED_FLAG)) {
                        bb.flags &= BlockFlags.VISTED_FLAG;

                        fillBB(bb);
                    }

                    bb = workList.pop();
                }
            }

            function fillBB(bb: BasicBlock) {
                valueMap.reset();
                curBBlock = bb;
                curState = bb.state;
                lastBB = bb;

                fillNodesToHIR(bb.node);

                bb.succs.forEach((succ) => {
                    if (succ.flags & BlockFlags.IS_ON_WORK_LIST) {
                        return;
                    }
                    workList.push(succ);
                    succ.flags &= BlockFlags.IS_ON_WORK_LIST;
                });

                (curState);
                (lastBB);
            }

            function fillNodesToHIR(node: Node | undefined) {
                if (!node) {
                    return;
                }

                iterateState = IterateState.IterateBegin;

                switch (node.kind) {
                    case SyntaxKind.FunctionDeclaration:
                    case SyntaxKind.SourceFile:
                         fillFuncEntryToHIR(node);
                        break;
                    case SyntaxKind.Block:
                        fillBlockToHIR(node as Block);
                        break;
                    case SyntaxKind.WhileStatement:
                        fillWhileToHIR(node as WhileStatement);
                        break;
                    default:
                        // normally, end bb
                        break;
                }

                Debug.assert(iterateState !== IterateState.IterateBegin);
                if (iterateState === IterateState.IterateBegin) {
                    // empty function
                    return;
                }

                if (iterateState === IterateState.IterateMeetBranch) {
                    return;
                }

                //find next node
            }
/*
            function isBlockEndNode(node: Node): Boolean {
                switch (node.kind) {
                    case SyntaxKind.IfStatement:
                    case SyntaxKind.WhileStatement:
                    case SyntaxKind.ReturnStatement:
                    case SyntaxKind.BreakStatement:
                    case SyntaxKind.ContinueStatement:
                        return true;
                    default:
                        return false;
                }
            }
*/
            function fillWithHintWorker(hint: EmitHint, node: Node): void {
                if (hint === EmitHint.SourceFile) return fillIRSourceFile(cast(node, isSourceFile));

                if (hint === EmitHint.Unspecified) {
                    switch (node.kind) {
                        case SyntaxKind.SourceFile:
                            fillIRSourceFile(node as SourceFile);
                            break;
                        case SyntaxKind.ExpressionStatement:
                            return fillIRExpressionStatement(node as ExpressionStatement);
                        case SyntaxKind.VariableStatement:
                            return fillIRVariableStatement(node as VariableStatement);
                        case SyntaxKind.VariableDeclarationList:
                            return fillIRVariableDeclarationList(node as VariableDeclarationList);
                        case SyntaxKind.VariableDeclaration:
                            return fillIRVariableDeclaration(node as VariableDeclaration);
                        case SyntaxKind.ReturnStatement:
                            fillIRReturnStatement(node as ReturnStatement);
                            iterateState = IterateState.IterateMeetBranch;
                            return;
                        case SyntaxKind.WhileStatement:
                            iterateState = IterateState.IterateMeetBranch;
                            return;
                        default:
                            break;
                    }
                }

                if (hint === EmitHint.Expression) {
                    switch (node.kind) {
                        // Literals
                        case SyntaxKind.NumericLiteral:
                        case SyntaxKind.BigIntLiteral:
                            return fillIRNumericOrBigIntLiteral(node as NumericLiteral | BigIntLiteral);
                        case SyntaxKind.BinaryExpression:
                            return fillIRBinaryExpression(node as BinaryExpression);
                        case SyntaxKind.StringLiteral:
                        case SyntaxKind.RegularExpressionLiteral:
                        case SyntaxKind.NoSubstitutionTemplateLiteral:
                            //return emitLiteral(node as LiteralExpression, /*jsxAttributeEscape*/ false);
                            break;
                        // Identifiers
                        case SyntaxKind.Identifier:
                            return fillIRIdentifier(node as Identifier);
                            break;
                        default:
                            break;
                    }
                }
            }

            function fillIR(node: Node, _parenthesizerRule?: (node: Node) => Node): void;
            function fillIR(node: Node | undefined, _parenthesizerRule?: (node: Node) => Node): void;
            function fillIR(node: Node | undefined, _parenthesizerRule?: (node: Node) => Node) {
                if (node === undefined) return;
                fillWithHintWorker(EmitHint.Unspecified, node);
            }

            function fillList(parentNode: Node | undefined, children: NodeArray<Node> | undefined, parenthesizerRule?: ParenthesizerRule<Node>, start?: number, count?: number) {
                fillNodeList(fillIR, parentNode, children, parenthesizerRule, start, count);
            }

            function fillNodeList(fillIR: (node: Node, parenthesizerRule?: ((node: Node) => Node) | undefined) => void, _parentNode: Node | undefined, children: NodeArray<Node> | undefined, parenthesizerRule: ParenthesizerRule<Node> | undefined, start = 0, count = children ? children.length - start : 0) {
                const isUndefined = children === undefined;
                if (isUndefined) {
                    return;
                }

                for (let i = 0; i < count; i++) {
                    const child = children[start + i];
                    if (iterateState === IterateState.IterateMeetBranch) {
                        return;
                    }
                    if (child.kind === SyntaxKind.FunctionDeclaration) {
                        continue;
                    }
                    fillIR(child, parenthesizerRule);
                }
            }

            function fillWhileToHIR(node: WhileStatement) {
                fillIRExpression(node.expression);
                iterateState = IterateState.IterateMeetBranch;
            }

            function fillBlockToHIR(node: Block) {
                (node);
            }

            function fillFuncEntryToHIR(entry: Node) {
                if (entry.kind === SyntaxKind.SourceFile) {
                    const statements = (entry as SourceFile).statements;
                    if (!statements.length) {
                        return;
                    }

                    iterateState = IterateState.IterateProcessing;

                    if (!!entry.locals) {
                        //declare locals
                    }

                    const index = findIndex(statements, statement => !isPrologueDirective(statement));
                    fillList(entry, statements, undefined, index === -1 ? statements.length : index);
                }
                else {
                    const body = (entry as FunctionDeclaration).body;
                    if (!body) {
                        return;
                    }
                    if (!body.statements.length) {
                        return;
                    }
                    iterateState = IterateState.IterateProcessing;
                    fillList(body, body.statements, undefined);
                }

            }

            function getNextIRId(): number {
                return IRId ++;
            }

            function fillIRSourceFile(node: SourceFile) {
                (node);
                (targetKind);
            }

            function appendIR2BB(ir: HIR): HIR {
                const canon = createCanonicalizer(getNextIRId, ir);
                const canonIR = canon.getCanonicalizedIR();

                const findedIR = valueMap.findAndInsert(canonIR);
                if (findedIR !== canonIR) {
                    return findedIR;
                }

                if (!!lastIR) {
                    lastIR.next = canonIR;
                }

                lastIR = canonIR;
                canonIR.bb = curBBlock;
                if (!curBBlock!.begin) {
                    curBBlock!.begin = canonIR;
                }
                canonIR.flags &= HIRFlags.LinkedInBB;

                return canonIR;
            }

            function fillIRVariableStatement(node: VariableStatement) {
                fillIR(node.declarationList);
            }

            function resolveVariable(node: Identifier, hint: VarKind = VarKind.Unknown): VarDesc | undefined{
                const symbol = checker!.getSymbolAtLocation(node);
                const type = checker!.getTypeAtLocation(node);

                if (!symbol) {
                    Debug.fail("HIRCompiler: cannot find the symbol.");
                }

                Debug.assert(symbol.flags & SymbolFlags.Variable);
                Debug.assert(!!symbol.stackIndex);

                let tsType: TSType = TSType.AnyType;
                if (type.flags & TypeFlags.Number) {
                    tsType = TSType.NumberType;
                }
                else if (type.flags & TypeFlags.NumberLiteral) {
                    tsType = TSType.NumberConstantType;
                }
                else if (type.flags & TypeFlags.String) {
                    tsType = TSType.StringType;
                }
                else if (type.flags & TypeFlags.Object) {
                    tsType = TSType.ObjectType;
                }

                const tsVarName = getTextOfNode(node, /*includeTrivia*/ false);
                const declaration = symbol.valueDeclaration;
                if (!declaration) {
                    return undefined;
                }
                const declarationContainer = getControlFlowContainer(declaration);
                const flowContainer = getControlFlowContainer(node);

                let varIndex = - 1;

                if (hint >= VarKind.LocalVar) {
                    // check if local variable
                    if (flowContainer === declarationContainer) {
                        const argCount = (declarationContainer as FunctionDeclaration).parameters.length;
                        varIndex = symbol.stackIndex - argCount;
                    }
                }

                //if (hint >= VarKind.GlobalVar) {

                //}

                //if (hint > VarKind.ModuleVar) {

                //}

                const resolvedVar: VarDesc = {
                    index: varIndex,
                    kind: VarKind.LocalVar,
                    name: tsVarName,
                    type: tsType,
                    subscript: -1,
                    container: declarationContainer,
                    symbol
                };

                return resolvedVar;
            }

            function fillIRVariableDeclaration(node: VariableDeclaration) {
                let varKind = VarKind.LocalVar;
                if (targetKind === CompileTargetKind.File) {
                    varKind = VarKind.GlobalVar;
                }
                else if (targetKind === CompileTargetKind.Module) {
                    varKind = VarKind.ModuleVar;
                }

                let resolvedVar: VarDesc | undefined;
                if (node.name.kind === SyntaxKind.Identifier) {
                    resolvedVar = resolveVariable(node.name, varKind);
                    Debug.assert(!!resolvedVar, "HIRCompiler: something wrong when resolve variable.");
                }
                else {
                    Debug.fail("HIRCompiler: no support for binding pattern right now.");
                }

                if (!!node.initializer) {
                    fillIRExpression(node.initializer);
                }
                else {
                    let val: number | string | object | undefined;
                    let constType = TSType.AnyType;
                    switch (resolvedVar.type) {
                        case TSType.NumberType:
                            val = 0;
                            constType = TSType.NumberType;
                            break;
                        case TSType.NumberConstantType:
                            val = 0;
                            constType = TSType.NumberType;
                            break;
                        default:
                            break;
                    }
                    let ir = new ConstantIRCtor(getNextIRId(), newConstantType(constType, val));
                    ir = appendIR2BB(ir);

                    pushStackValue(curState!, ir);
                }

                const varDef = popStackValue(curState!, TSType.NumberType);
                Debug.assert(!!varDef);

                if (resolvedVar.type === TSType.NumberConstantType ||
                    resolvedVar.type === TSType.StringConstantType ||
                    resolvedVar.type === TSType.ObjectConstantType) {
                    resolvedVar.type --;
                }
                storeLocal(curState!, resolvedVar, varDef);
            }

            function fillIRVariableDeclarationList(node: VariableDeclarationList) {
                fillList(node, node.declarations);
            }

            function fillIRReturnStatement(node: ReturnStatement) {
                fillIRExpression(node.expression);

                let ir: HIR;
                if (!node.expression) {
                    ir = new ReturnIRCtor(getNextIRId(), undefined);
                }
                else {
                    const type = checker!.getTypeAtLocation(node.expression);
                    let tsType = TSType.AnyType;

                    if (type.flags & TypeFlags.Number) {
                        tsType = TSType.NumberType;
                    }

                    const retVal = popStackValue(curState!, tsType);
                    ir = new ReturnIRCtor(getNextIRId(), retVal);
                }

                appendIR2BB(ir);
            }

            function fillIRExpressionStatement(node: ExpressionStatement) {
                fillIRExpression(node.expression);
                popStackValue(curState!, undefined);
            }

            function fillIRExpression(node: Expression, _parenthesizerRule?: (node: Expression) => Expression): void;
            function fillIRExpression(node: Expression | undefined, _parenthesizerRule?: (node: Expression) => Expression): void;
            function fillIRExpression(node: Expression | undefined, _parenthesizerRule?: (node: Expression) => Expression) {
                if (node === undefined) return;
                fillWithHintWorker(EmitHint.Expression, node);
            }

            function fillIRIdentifier(node: Identifier) {
                const resolvedVar = resolveVariable(node, VarKind.Unknown);
                Debug.assert(!!resolvedVar);

                if (resolvedVar.kind === VarKind.LocalVar) {
                    const val = curState!.locals[resolvedVar.index];
                    //Debug.assert(!!val);

                    const ir = new LocalIRCtor(getNextIRId(), !!val ? val.valType : undefined ,resolvedVar.index, val, false);
                    pushStackValue(curState!, ir);
                }
                else {
                    Debug.fail("HIRCompiler: no support global/closure var right now.");
                }

            }

            function fillIRNumericOrBigIntLiteral(node: NumericLiteral | BigIntLiteral) {
                const text = getLiteralTextOfNode(node, printerOptions.neverAsciiEscape, false);
                let val = 0;

                if (node.kind === SyntaxKind.NumericLiteral) {
                    val = +text;
                }

                let ir = new ConstantIRCtor(getNextIRId(), newConstantType(TSType.NumberType, val));
                ir = appendIR2BB(ir);

                pushStackValue(curState!, ir);
            }

            function createFillIRBinaryExpression() {
                interface WorkArea {
                    stackIndex: number;
                    operatorTokens: BinaryOperatorToken[];
                }

                return createBinaryExpressionTrampoline(onEnter, onLeft, onOperator, onRight, onExit, /*foldState*/ undefined);

                function onEnter(_node: BinaryExpression, state: WorkArea | undefined) {
                    if (state) {
                        state.stackIndex++;
                    }
                    else {
                        state = {
                            stackIndex: 0,
                            operatorTokens: [],
                        };
                    }
                    return state;
                }

                function onLeft(next: Expression, _workArea: WorkArea, parent: BinaryExpression) {
                    const expr = maybeEmitExpression(next, parent, "left");
                    return expr;
                }

                function onOperator(operatorToken: BinaryOperatorToken, _state: WorkArea, _node: BinaryExpression) {
                    _state.operatorTokens.push(operatorToken);
                }

                function onRight(next: Expression, _workArea: WorkArea, parent: BinaryExpression) {
                    const expr =  maybeEmitExpression(next, parent, "right");
                    return expr;
                }

                function onExit(node: BinaryExpression, state: WorkArea) {
                    if (state.stackIndex > 0) {
                        state.stackIndex--;
                    }

                    state.operatorTokens.pop();

                    fillIRBinaryExpressionInternal(node);
                }

                function maybeEmitExpression(next: Expression, _parent: BinaryExpression, _side: "left" | "right") {

                    if (isBinaryExpression(next)) {
                        return next;
                    }

                    fillWithHintWorker(EmitHint.Expression, next);
                }
            }

            function findVarDefine(bb: BasicBlock, localIndex: number): HIR {
                if (bb.preds.size === 1) {
                    let ret: HIR;
                    bb.preds.forEach(pred => {
                        const local = pred.state!.locals[localIndex];
                        if (!!local) {
                            ret = local;
                            return;
                        }

                        ret = findVarDefine(pred, localIndex);
                        return;
                    });

                    return ret!;
                }
                else {
                    const phi = new PhiIRCtor(getNextIRId(), localIndex);
                    return phi;
                }
            }

            function fillIRBinaryExpressionInternal(node: BinaryExpression) {
                const rhs = popStackValue(curState!, undefined);
                const lhs = popStackValue(curState!, undefined);
                let rhsVal, lhsVal: HIR;

                if (rhs!.op === OpKind.Local) {
                    if (!!rhs!.sub) {
                        rhsVal = rhs!.sub;
                    }
                    else {
                        rhsVal = findVarDefine(curBBlock!, (rhs as LocalIR).localIndex);
                    }
                }
                else {
                    rhsVal = rhs!;
                }

                if (isAssignmentExpression(node)) {
                    Debug.assert(lhs!.op === OpKind.Local);
                    curState!.locals[(lhs as LocalIR).localIndex] = rhsVal;
                    pushStackValue(curState!, lhs!);
                    return;
                }
                else {
                    if (lhs!.op === OpKind.Local) {
                        //read local recursively
                        if (!!lhs!.sub) {
                            lhsVal = lhs!.sub;
                        }
                        else {
                            lhsVal = findVarDefine(curBBlock!, (lhs as LocalIR).localIndex);
                        }
                    }
                    else {
                        lhsVal = lhs!;
                    }
                }

                switch (node.operatorToken.kind) {
                    case SyntaxKind.PlusToken:
                        fillIRBinaryExpressionPlus(lhsVal, rhsVal);
                        break;
                    default:
                        break;
                }
            }

            function fillIRBinaryExpressionPlus(lhs: HIR, rhs: HIR) {
                let ir: HIR = new ArithmeticOPIRCtor(getNextIRId(), SyntaxKind.PlusToken, lhs, rhs);
                ir = appendIR2BB(ir);

                pushStackValue(curState!, ir);
            }



            // ------------------------------------------------------------------------------------
            // build basic block
            function buildBBInFunction(node: Node) {
                if (node.kind !== SyntaxKind.SourceFile &&
                    node.kind !== SyntaxKind.FunctionDeclaration) {
                    return;
                }

                buildBB(node);
            }

            function simplifyBB() {
                const copyBlocks: BasicBlock[] = [];
                blocks.forEach((bb) => {
                    if (bb.preds.size === 0) {
                        return;
                    }

                    if (!bb.node && bb.preds.size === 1 && bb.succs.size <= 1) {
                        bb.preds.forEach((pred) => {
                            pred.succs.delete(bb);
                            bb.succs.forEach((succ) => {
                                succ.preds.delete(bb);
                                pred.succs.add(succ);
                                succ.preds.add(pred);
                            });
                        });
                    }
                });

                blocks.forEach((bb) => {
                    if (!bb.node) {
                        return;
                    }

                    copyBlocks.push(bb);
                });

                blocks = copyBlocks;
            }

            function markLoops() {
                activeBB = new Array(blocks.length);
                visitedBB = new Array(blocks.length);
                loopMap = new Array(blocks.length);
                activeBB.fill(false);
                visitedBB.fill(false);
                loopMap.fill(0);

                nextLoopId = 0;
                nextBlockNum = blocks.length;

                markLoopsIter(blocks[0]);
            }

            function makeLoopHeader(bb: BasicBlock) {
                if (!(bb.flags & BlockFlags.PARSE_LOOP_HEADER_FLAG)) {
                    bb.flags |= BlockFlags.PARSE_LOOP_HEADER_FLAG;

                    Debug.assert(loopMap[bb.blockId] === 0);
                    Debug.assert(nextLoopId >= 0 && nextLoopId < 32);
                    loopMap[bb.blockId] = 1 << nextLoopId;
                    if (nextLoopId < 31) {
                        nextLoopId ++;
                    }
                }
            }

            function mergeUnion(dst: Boolean[], src: Boolean[]) {
                dst.forEach((_, i, array) =>{
                    if (i < src.length) {
                        array[i] ||= src[i];
                    }
                }
                );
            }

            function markLoopsIter(bb: BasicBlock): number {
                const id = bb.blockId;
                if (visitedBB[id]) {
                    if (activeBB[id]) {
                        makeLoopHeader(bb);
                    }
                    return loopMap[id];
                }

                visitedBB[id] = true;
                activeBB[id] = true;

                let loopState = 0;
                bb.succs.forEach((succ) => {
                    loopState |= markLoopsIter(succ);
                });

                activeBB[id] = false;
                setBBDepth(bb, nextBlockNum);
                nextBlockNum --;

                if (loopState !== 0) {
                    mergeUnion(requestPhi, bb.storeToLocals);
                }

                if (bb.flags & BlockFlags.PARSE_LOOP_HEADER_FLAG) {
                    const headerLoopState = loopMap[id];
                    if (headerLoopState < 0x80000000) {
                        loopState &= ~headerLoopState;
                    }
                }

                loopMap[id] = loopState;
                return loopState;
            }

            function newBBlock(tsBlock: TSBlock, node: Node | undefined, pred: BasicBlock | undefined): BasicBlock {
                const bb = makeBBlock(nextBBlockId, tsBlock, node, pred, getName(tsBlock, node))!;
                resetBBLocalsArray(bb, localsCount);
                nextBBlockId ++;
                blocks.push(bb);
                return bb;
            }

            function addBBPred(bb: BasicBlock, pred: BasicBlock) {
                bb.preds.add(pred);
                pred.succs.add(bb);
            }

            function markBBLocalStore(node: Node) {
                const symbol = checker!.getSymbolAtLocation(node);
                if (!symbol) {
                    return;
                }

                if (!symbol.stackIndex) {
                    return;
                }

                const declaration = symbol.valueDeclaration;
                if (!declaration) {
                    return;
                }
                const declarationContainer = getControlFlowContainer(declaration);
                Debug.assert(declarationContainer.kind === SyntaxKind.FunctionDeclaration ||
                    declarationContainer.kind === SyntaxKind.SourceFile);

                const flowContainer = getControlFlowContainer(node);
                Debug.assert(flowContainer === getParseTreeNode(curFunc));
                Debug.assert(!!curBBlock);
                if (declarationContainer === flowContainer) {
                    // local var
                    curBBlock.storeToLocals[symbol.stackIndex] = true;
                    curBBlock.storedLocalsInfo[symbol.stackIndex] = symbol;
                }
                else {
                    //closure var
                    const funcDecl = flowContainer as FunctionDeclaration;
                    if (!funcDecl.closureVars) {
                        return;
                    }
                    const cvNum = funcDecl.closureVars.length;
                    const cvStartId = curBBlock.storeToLocals.length - cvNum;
                    for (let i = 0; i < cvNum; i++) {
                        if (funcDecl.closureVars[i].symbol === symbol) {
                            curBBlock.storeToLocals[cvStartId + i] = true;
                            curBBlock.storedLocalsInfo[cvStartId + i] = symbol;
                            break;
                        }
                    }
                }
            }

            function clearBBSuccs(bb: BasicBlock) {
                if (!!bb.succs.size) {
                    bb.succs.forEach((succ) => {
                        succ.preds.delete(bb);
                    });
                    bb.succs.clear();
                }
            }

            function getBBlockCount(): number {
                return blocks.length;
            }

            function getCurBBlock(): BasicBlock | undefined {
                return curBBlock;
            }

            function setCurBBlock(bb: BasicBlock | undefined) {
                curBBlock = bb;
            }

            function resetCurBBlock() {
                curBBlock = undefined;
            }

            function getName(tsBlock: TSBlock, node: Node | undefined): string {
                let tsBlockName = "";
                switch (tsBlock.kind) {
                    case SyntaxKind.SourceFile:
                        tsBlockName = "file entry";
                        break;
                    case SyntaxKind.FunctionDeclaration:
                        tsBlockName = "function entry";
                        break;
                    case SyntaxKind.IfStatement:
                        tsBlockName = "if";
                        break;
                    case SyntaxKind.WhileStatement:
                        tsBlockName = "while";
                        break;
                    default:
                        break;
                }

                if (!node) {
                    return "+" + tsBlockName + " end";
                }

                switch (node.kind) {
                    case SyntaxKind.SourceFile:
                    case SyntaxKind.FunctionDeclaration:
                        case SyntaxKind.WhileStatement:
                        return "+" + tsBlockName;
                    case SyntaxKind.Block: {
                            const originNode = getParseTreeNode(node);
                            if (originNode && originNode.parent) {
                                if (originNode.parent.kind === SyntaxKind.IfStatement) {
                                    if ((originNode.parent as IfStatement).thenStatement === node) {
                                        return "+if then";
                                    }
                                    else if ((originNode.parent as IfStatement).elseStatement === node) {
                                        return "+else";
                                    }
                                }
                                else if (originNode.parent.kind === SyntaxKind.WhileStatement) {
                                    return "+while body";
                                }
                            }
                            return "";
                        }
                    default:
                        return "";
                }
            }

            function enterTSBlock(node: Node): TSBlock {
                const tsBlock = newTSBlock(node.kind);
                if (node.kind === SyntaxKind.SourceFile ||
                    node.kind === SyntaxKind.FunctionDeclaration) {
                    const entryBB = newBBlock(tsBlock, node, undefined);
                    const originNode = getParseTreeNode(node);
                    if (originNode &&
                        (originNode.kind === SyntaxKind.SourceFile ||
                        (originNode.parent && originNode.parent.kind === SyntaxKind.FunctionDeclaration))) {
                        entryBB.flags = BlockFlags.STD_ENTRY_FLAG;
                    }
                    tsBlock.entryBlock = entryBB;
                    curBBlock = entryBB;
                }

                return tsBlock;
            }

            function exitTSBlock() {
                const tsBlock = TSBlockStack.pop()!;
                if (!tsBlock.endBlock && !!curBBlock) {
                    tsBlock.endBlock = newBBlock(tsBlock, undefined, curBBlock);
                }
                curBBlock = tsBlock.endBlock;
                return tsBlock;
            }

            function newTSBlock(kind: SyntaxKind): TSBlock {
                const tsBlock: TSBlock = {
                    blockId: nextTSBlockId,
                    kind,
                    reachable: true,
                    entryBlock: undefined,
                    elseBlock: undefined,
                    endBlock: undefined
                };

                TSBlockStack.push(tsBlock);
                nextTSBlockId ++;
                return tsBlock;
            }

            function getCurTSBlock(): TSBlock | undefined {
                if (TSBlockStack.length === 0) {
                    return undefined;
                }
                return TSBlockStack[TSBlockStack.length - 1];
            }

            function getCurFuncTSBlock(): TSBlock | undefined {
                if (TSBlockStack.length === 0) {
                    return undefined;
                }
                return TSBlockStack[0];
            }

            function getLastLoopTSBlock(): TSBlock | undefined {
                if (TSBlockStack.length === 0) {
                    return undefined;
                }

                for (let i = TSBlockStack.length; i > 0; i --) {
                    const tsBlock = TSBlockStack[i - 1];
                    if (tsBlock.entryBlock && tsBlock.entryBlock.node!.kind === SyntaxKind.WhileStatement) {
                        return tsBlock;
                    }
                }

                return undefined;
            }

            function dumpBBGraph() {
                let funcName = "";
                if (curFunc.kind === SyntaxKind.SourceFile) {
                    funcName = (curFunc as SourceFile).fileName;
                }
                else {
                    const funcNode = curFunc as FunctionDeclaration;
                    funcName = funcNode.name ? getTextOfNode(funcNode.name, /*includeTrivia*/ false) : "anonymous function";
                }

                Debug.log("-------------------------------------------------------------------------");
                Debug.log(funcName + " includes " + getBBlockCount() + " basic blocks.");
                blocks.forEach((bb) => {
                    const info = "bb id: " + bb.blockId + " tsb:" + bb.tsBlock.blockId + ":" + bb.name + " <---- ";
                    let preds = "";
                    bb.preds.forEach((pred) => {
                        preds += pred.blockId + " ";
                    });
                    let updatedVars = "";
                    bb.storedLocalsInfo.forEach(symbol => {
                        if (!symbol) {
                            return;
                        }

                        updatedVars += symbol.escapedName + ":" + symbol.stackIndex + " ";
                    });
                    if (updatedVars.length) {
                        updatedVars = " updated vars: " + updatedVars;
                    }
                    Debug.log(info + preds + updatedVars);
                });

                Debug.log("-------------------------------------------------------------------------");
            }

            function buildBB(node: Node | undefined): void {
                if (!node) {
                    return;
                }

                const curBB = getCurBBlock();

                if (!!curBB && !curBB.node) {
                    curBB.node = node;
                }

                buildBBWorker(node);

                if (node.kind > SyntaxKind.LastToken) {
                    buildBBChildren(node);
                }
            }

            function buildBBWorker(node: Node) {
                switch (node.kind) {
                    case SyntaxKind.Identifier:
                        buildBBForIdentifier(node as Identifier);
                        break;
                    case SyntaxKind.CallExpression:
                        break;
                    default:
                        break;
                }
            }

            function buildBBEach(nodes: NodeArray<Node> | undefined, handlerFunc: (node: Node) => void = buildBB): void {
                if (nodes === undefined) {
                    return;
                }

                forEach(nodes, handlerFunc);
            }

            function buildBBEachChild(node: Node) {
                forEachChild(node, buildBB, buildBBEach);
            }

            function buildBBChildren(node: Node) {
                switch (node.kind) {
                    case SyntaxKind.SourceFile: {
                        buildBBForSource(node);
                        break;
                    }
                    case SyntaxKind.FunctionDeclaration:
                        buildBBForFunctionDeclaration(node as FunctionDeclaration);
                        break;
                    case SyntaxKind.Block:
                    case SyntaxKind.ModuleBlock:
                        buildBBForBlock(node);
                        break;
                    case SyntaxKind.IfStatement:
                        buildBBForIf(node as IfStatement);
                        break;
                    case SyntaxKind.WhileStatement:
                        buildBBForWhile(node as WhileStatement);
                        break;
                    case SyntaxKind.ReturnStatement:
                        buildBBForReturn(node as ReturnStatement);
                        break;
                    case SyntaxKind.BreakStatement:
                        buildBBForBreak(node as BreakStatement);
                        break;
                    case SyntaxKind.ContinueStatement:
                        buildBBForContinue(node as ContinueStatement);
                        break;
                    default:
                        buildBBEachChild(node);
                        break;
                }
            }

            function buildBBForIdentifier(node: Identifier) {
                if (!isAssignmentTarget(node)) {
                    return;
                }

                markBBLocalStore(node);
            }

            function buildBBForSource(node: Node) {
                enterTSBlock(node);
                traverseStatementsOnly((node as SourceFile).statements, buildBB);
                exitTSBlock();
                simplifyBB();
                dumpBBGraph();
            }

            function buildBBForFunctionDeclaration(node: FunctionDeclaration) {
                const originNode = getParseTreeNode(node);
                if (!originNode) {
                    return;
                }

                enterTSBlock(originNode); // entry block
                if (node.body) {
                    traverseStatementsOnly(node.body.statements, buildBB);
                }
                exitTSBlock();
                simplifyBB();
                dumpBBGraph();
                markLoops();
            }

            function buildBBForBlock(node: Node) {

                traverseStatementsOnly((node as Block).statements, buildBB);
            }

            function buildBBForIf(node: IfStatement) {

                const lastBB = getCurBBlock();
                if (!lastBB) {
                    return;
                }

                const tsBlock = enterTSBlock(node);
                let thenBB: BasicBlock | undefined = newBBlock(tsBlock, node.thenStatement, lastBB);
                setCurBBlock(thenBB);
                buildBB(node.thenStatement);
                thenBB = getCurBBlock();
                let elseBB: BasicBlock | undefined;
                if (node.elseStatement) {
                    elseBB = newBBlock(tsBlock, node.elseStatement, lastBB);
                    setCurBBlock(elseBB);
                    buildBB(node.elseStatement);
                    elseBB = getCurBBlock();
                }

                if (!!thenBB || !!elseBB) {
                    const endBB = newBBlock(tsBlock, node.elseStatement, undefined);
                    tsBlock.endBlock = endBB;
                    if (!!thenBB) {
                        addBBPred(endBB, thenBB);
                    }

                    if (!!elseBB) {
                        addBBPred(endBB, elseBB);
                    }
                    else {
                        addBBPred(endBB, lastBB);
                    }
                }
                else if (!!node.elseStatement) {
                    // both then and else have branch statement.
                    setCurBBlock(undefined);
                }
                else {
                    // then has branch statement
                    const endBB = newBBlock(tsBlock, undefined, lastBB);
                    tsBlock.endBlock = endBB;
                }

                exitTSBlock();
            }

            function buildBBForWhile(node: WhileStatement) {
                // create loop entry BB
                const outerBB = getCurBBlock();
                if (!outerBB) {
                    return;
                }

                const tsBlock = enterTSBlock(node);
                const entryBB = newBBlock(tsBlock, node, outerBB);
                tsBlock.entryBlock = entryBB;
                setCurBBlock(entryBB);

                // create loop body BB
                const loopBB = newBBlock(tsBlock, node.statement, tsBlock.entryBlock);
                setCurBBlock(loopBB);

                // create loop end BB
                const endBlock = newBBlock(tsBlock, undefined, tsBlock.entryBlock);
                tsBlock.endBlock = endBlock;

                // deal with loop Body
                buildBB(node.statement);

                // add the back edge to loop entry
                const curBB = getCurBBlock();
                if (!!curBB) {
                    addBBPred(tsBlock.entryBlock, curBB); //back edge
                }

                exitTSBlock();
            }

            function buildBBForReturn(node: ReturnStatement) {
                (node);

                const curBB = getCurBBlock()!;
                const funcTSBlock = getCurFuncTSBlock()!;
                if (!funcTSBlock.endBlock) {
                    funcTSBlock.endBlock = newBBlock(funcTSBlock, undefined, curBB);
                }

                addBBPred(funcTSBlock.endBlock, curBB);
                setCurBBlock(undefined);

                const tsBlock = getCurTSBlock();
                if (!!tsBlock) {
                    tsBlock.reachable = false;
                }
            }

            function buildBBForBreak(node: BreakStatement) {
                (node);

                const curBB = getCurBBlock()!;
                const loopTSBlock = getLastLoopTSBlock()!;
                Debug.assert(!!loopTSBlock, "break MUST be within a loop.");
                if (!loopTSBlock.endBlock) {
                    loopTSBlock.endBlock = newBBlock(loopTSBlock, undefined, loopTSBlock.entryBlock);
                }

                Debug.assert(curBB.succs.size <= 1);
                clearBBSuccs(curBB);
                addBBPred(loopTSBlock.endBlock, curBB);
                setCurBBlock(undefined);

                const tsBlock = getCurTSBlock();
                if (!!tsBlock) {
                    tsBlock.reachable = false;
                }
            }

            function buildBBForContinue(node: ContinueStatement) {
                (node);

                const curBB = getCurBBlock()!;
                const loopTSBlock = getLastLoopTSBlock()!;
                if (!loopTSBlock.endBlock) {
                    loopTSBlock.endBlock = newBBlock(loopTSBlock, undefined, loopTSBlock.entryBlock);
                }

                addBBPred(loopTSBlock.entryBlock!, curBB);
                setCurBBlock(undefined);

                const tsBlock = getCurTSBlock();
                if (!!tsBlock) {
                    tsBlock.reachable = false;
                }
            }


        }

        function buildSourceFile(node: SourceFile) {
            buildCallGraphForSource(node);
            buildBasicBlocksInCallGraphs();
        }

        function buildBasicBlocksInCallGraphs() {
            callGraph.buildBBForAllFuncs();
        }

        function buildCallGraphForSource(node: SourceFile) {
            callGraph = newCallGraph();

            callGraph.addFunc(node);
            callGraph.initLocals(node);

            traverseEachFunctionsFirst(node.statements, buildCallGraph);
            callGraph.dump();
        }

        function buildCallGraph(node: Node) {
            if (!node) {
                return;
            }

            buildCallGraphWorker(node);

            if (node.kind > SyntaxKind.LastToken) {
                buildCallGraphChildren(node);
            }
        }

        function buildCallGraphWorker(node: Node) {
            switch (node.kind) {
                case SyntaxKind.CallExpression:
                    buildCallGraphForCallExpression(node as ExpressionStatement);
                    break;
                case SyntaxKind.Identifier:
                    buildCallGraphForIdentifier(node as Identifier);
                    break;
                default:
                    break;
            }
        }

        function buildCallGraphForFunction(node: FunctionDeclaration) {
            callGraph.addFunc(node);
            callGraph.initLocals(node);

            if (!node.body) {
                return;
            }

            traverseEachFunctionsFirst(node.body.statements, buildCallGraph);

            callGraph.exitFunc();
        }

        function buildCallGraphForBlock(node: Block) {
            const originNode = getParseTreeNode(node);
            if (!originNode) {
                return;
            }

            if (originNode.parent.kind !== SyntaxKind.FunctionDeclaration) {
                callGraph.initLocals(originNode);
            }

            traverseEachFunctionsFirst(node.statements, buildCallGraph);
        }

        function buildCallGraphForCallExpression(node: ExpressionStatement) {
            callGraph.addCall(node.expression);
        }

        function buildCallGraphForIdentifier(node: Identifier) {
            const symbol = checker!.getSymbolAtLocation(node);
            if (!symbol) {
                return;
            }

            if (symbol.stackIndex === undefined) {
                return;
            }

            const originNode = getParseTreeNode(node);
            if (!originNode) {
                return;
            }
            if (!isAssignmentTarget(originNode)) {
                return;
            }

            callGraph.markClosureVarStore(node);
        }

        function buildCallGraphEach(nodes: NodeArray<Node> | undefined, handlerFunc: (node: Node) => void = buildCallGraph): void {
            if (nodes === undefined) {
                return;
            }

            forEach(nodes, handlerFunc);
        }

        function buildCallGraphEachChild(node: Node) {
            forEachChild(node, buildCallGraph, buildCallGraphEach);
        }

        function buildCallGraphChildren(node: Node) {
            switch (node.kind) {
                case SyntaxKind.FunctionDeclaration:
                    buildCallGraphForFunction(node as FunctionDeclaration);
                    break;
                case SyntaxKind.Block:
                    buildCallGraphForBlock(node as Block);
                    break;
                default:
                    buildCallGraphEachChild(node);
                    break;
            }
        }

        function traverseEachFunctionsFirst(nodes: NodeArray<Node> | undefined, handlerFunc: (node: Node) => void): void {
            traverseEach(nodes, n => n.kind === SyntaxKind.FunctionDeclaration ? handlerFunc(n) : undefined);
            traverseEach(nodes, n => n.kind !== SyntaxKind.FunctionDeclaration ? handlerFunc(n) : undefined);
            //buildBBList(node, nodes);
        }

        function traverseStatementsOnly(nodes: NodeArray<Node> | undefined, handlerFunc: (node: Node) => void): void {
            traverseEach(nodes, n => n.kind !== SyntaxKind.FunctionDeclaration ? handlerFunc(n) : undefined);
            //buildBBList(node, nodes);
        }

        function traverseEach(nodes: NodeArray<Node> | undefined, handlerFunc: (node: Node) => void): void {
            if (nodes === undefined) {
                return;
            }

            forEach(nodes, handlerFunc);
        }

        function emit(node: Node, parenthesizerRule?: (node: Node) => Node): void;
        function emit(node: Node | undefined, parenthesizerRule?: (node: Node) => Node): void;
        function emit(node: Node | undefined, parenthesizerRule?: (node: Node) => Node) {
            if (node === undefined) return;
            //const prevSourceFileTextKind = recordBundleFileInternalSectionStart(node);
            pipelineEmit(EmitHint.Unspecified, node, parenthesizerRule);
            //recordBundleFileInternalSectionEnd(prevSourceFileTextKind);
        }

        function emitList(parentNode: Node | undefined, children: NodeArray<Node> | undefined, format: ListFormat, parenthesizerRule?: ParenthesizerRuleOrSelector<Node>, start?: number, count?: number) {
            emitNodeList(emit, parentNode, children, format, parenthesizerRule, start, count);
        }

        function emitNodeList(emit: (node: Node, parenthesizerRule?: ((node: Node) => Node) | undefined) => void, parentNode: Node | undefined, children: NodeArray<Node> | undefined, format: ListFormat, parenthesizerRule: ParenthesizerRuleOrSelector<Node> | undefined, start = 0, count = children ? children.length - start : 0) {
            (parentNode);
            (parenthesizerRule);
            (emit);
            const isUndefined = children === undefined;
            if (isUndefined && format & ListFormat.OptionalIfUndefined) {
                return;
            }

            const isEmpty = children === undefined || start >= children.length || count === 0;
            if (onBeforeEmitNodeArray) {
                onBeforeEmitNodeArray(children);
            }

            if (!isEmpty) {
                Debug.type<NodeArray<Node>>(children);

                //const emitListItem = getEmitListItem(emit, parenthesizerRule);

                // Emit each child.
                //let previousSourceFileTextKind: ReturnType<typeof recordBundleFileInternalSectionStart>;
                for (let i = 0; i < count; i++) {
                    //const child = children[start + i];

                    // Emit this child.
                    //previousSourceFileTextKind = recordBundleFileInternalSectionStart(child);

                    //emitListItem(child, emit, parenthesizerRule, i);
                }

                //recordBundleFileInternalSectionEnd(previousSourceFileTextKind);
            }

            if (onAfterEmitNodeArray) {
                onAfterEmitNodeArray(children);
            }
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
/*
        function reserveNameInNestedScopes(name: string) {
            if (!reservedNames || reservedNames === lastOrUndefined(reservedNamesStack)) {
                reservedNames = new Set();
            }
            reservedNames.add(name);
        }
*/
        /**
         * Return the next available name in the pattern _a ... _z, _0, _1, ...
         * TempFlags._i or TempFlags._n may be used to express a preference for that dedicated name.
         * Note that names generated by makeTempVariableName and makeUniqueName will never conflict.
         */
/*
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
*/
        /**
         * Generate a name that is unique within the current file and doesn't conflict with any names
         * in global scope. The name is formed by adding an '_n' suffix to the specified base name,
         * where n is a positive integer. Note that names generated by makeTempVariableName and
         * makeUniqueName are guaranteed to never conflict.
         * If `optimistic` is set, the first instance will use 'baseName' verbatim instead of 'baseName_1'
         */
/*
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
            return makeUniqueName(name, isFileLevelUniqueName, true);
        }
*/
        /**
         * Generates a unique identifier for a node.
         */
/*
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
*/

        /**
         * Returns a value indicating whether a name is unique globally, within the current file,
         * or within the NameGenerator.
         */
/*
        function isUniqueName(name: string): boolean {
            return isFileLevelUniqueName(name)
                && !generatedNames.has(name)
                && !(reservedNames && reservedNames.has(name));
        }
*/
        /**
         * Returns a value indicating whether a name is unique globally or within the current file.
         */
/*
         function isFileLevelUniqueName(name: string) {
            return currentSourceFile ? ts.isFileLevelUniqueName(currentSourceFile, name, hasGlobalName) : true;
        }
*/
        /**
         * Returns a value indicating whether a name is unique within a container.
         */
/*
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

        // write functions
        function writeLine(count = 1) {
            for (let i = 0; i < count; i++) {
                writer.writeLine(i > 0);
            }
        }
*/
        //function writeBase(s: string) {
        //    writer.write(s);
        //}
    }
}