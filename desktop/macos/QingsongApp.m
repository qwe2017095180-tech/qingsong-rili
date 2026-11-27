#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

@interface QingsongAppDelegate : NSObject <NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate>
@property (nonatomic, strong) NSWindow *window;
@property (nonatomic, strong) WKWebView *webView;
@property (nonatomic, strong) NSTask *serverTask;
@property (nonatomic, assign) BOOL ownsServer;
@property (nonatomic, strong) NSURL *serverURL;
@property (nonatomic, copy) NSString *projectDir;
@end

@implementation QingsongAppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    self.projectDir = [self resolveProjectDir];
    [self setupMenu];
    [self setupWindow];
    [self showSplash:@"正在启动轻松日程…" isError:NO];
    [self bootstrapServer];
}

- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)flag {
    if (!flag) {
        [self.window makeKeyAndOrderFront:nil];
    }
    return YES;
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
    return YES;
}

- (void)applicationWillTerminate:(NSNotification *)notification {
    [self stopOwnedServer];
}

#pragma mark - Window & Menu

- (void)setupWindow {
    NSRect frame = NSMakeRect(0, 0, 1260, 860);
    NSWindowStyleMask style = NSWindowStyleMaskTitled | NSWindowStyleMaskClosable |
                              NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable;
    self.window = [[NSWindow alloc] initWithContentRect:frame
                                              styleMask:style
                                                backing:NSBackingStoreBuffered
                                                  defer:NO];
    self.window.title = @"轻松日程";
    self.window.minSize = NSMakeSize(860, 600);
    self.window.backgroundColor = [NSColor colorWithCalibratedRed:0.953 green:0.933 blue:0.933 alpha:1.0];
    self.window.delegate = self;
    [self.window center];
    [self.window setFrameAutosaveName:@"QingsongRiliMainWindow"];

    WKWebViewConfiguration *config = [[WKWebViewConfiguration alloc] init];
    [config.preferences setValue:@YES forKey:@"developerExtrasEnabled"];

    self.webView = [[WKWebView alloc] initWithFrame:self.window.contentView.bounds configuration:config];
    self.webView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    self.webView.navigationDelegate = self;
    self.webView.UIDelegate = self;
    [self.webView setValue:@NO forKey:@"drawsBackground"];

    [self.window.contentView addSubview:self.webView];
    [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
}

- (void)setupMenu {
    NSMenu *mainMenu = [[NSMenu alloc] init];

    // App menu
    NSMenuItem *appItem = [[NSMenuItem alloc] init];
    [mainMenu addItem:appItem];
    NSMenu *appMenu = [[NSMenu alloc] initWithTitle:@"轻松日程"];
    [appMenu addItemWithTitle:@"关于轻松日程" action:@selector(orderFrontStandardAboutPanel:) keyEquivalent:@""];
    [appMenu addItem:[NSMenuItem separatorItem]];
    [appMenu addItemWithTitle:@"打开数据目录" action:@selector(openDataFolder) keyEquivalent:@""];
    [appMenu addItemWithTitle:@"在浏览器中打开" action:@selector(openInBrowser) keyEquivalent:@""];
    [appMenu addItem:[NSMenuItem separatorItem]];
    [appMenu addItemWithTitle:@"隐藏轻松日程" action:@selector(hide:) keyEquivalent:@"h"];
    [appMenu addItemWithTitle:@"退出轻松日程" action:@selector(terminate:) keyEquivalent:@"q"];
    appItem.submenu = appMenu;

    // Edit menu (enables Cmd+C/V/X/A/Z in WKWebView inputs)
    NSMenuItem *editItem = [[NSMenuItem alloc] init];
    [mainMenu addItem:editItem];
    NSMenu *editMenu = [[NSMenu alloc] initWithTitle:@"编辑"];
    [editMenu addItemWithTitle:@"撤销" action:NSSelectorFromString(@"undo:") keyEquivalent:@"z"];
    [editMenu addItemWithTitle:@"重做" action:NSSelectorFromString(@"redo:") keyEquivalent:@"Z"];
    [editMenu addItem:[NSMenuItem separatorItem]];
    [editMenu addItemWithTitle:@"剪切" action:@selector(cut:) keyEquivalent:@"x"];
    [editMenu addItemWithTitle:@"复制" action:@selector(copy:) keyEquivalent:@"c"];
    [editMenu addItemWithTitle:@"粘贴" action:@selector(paste:) keyEquivalent:@"v"];
    [editMenu addItemWithTitle:@"全选" action:@selector(selectAll:) keyEquivalent:@"a"];
    editItem.submenu = editMenu;

    // View menu
    NSMenuItem *viewItem = [[NSMenuItem alloc] init];
    [mainMenu addItem:viewItem];
    NSMenu *viewMenu = [[NSMenu alloc] initWithTitle:@"视图"];
    [viewMenu addItemWithTitle:@"重新加载" action:@selector(reloadPage) keyEquivalent:@"r"];
    [viewMenu addItemWithTitle:@"回到首页" action:@selector(goHome) keyEquivalent:@"H"];
    [viewMenu addItem:[NSMenuItem separatorItem]];
    [viewMenu addItemWithTitle:@"后退" action:@selector(goBack) keyEquivalent:@"["];
    [viewMenu addItemWithTitle:@"前进" action:@selector(goForward) keyEquivalent:@"]"];
    viewItem.submenu = viewMenu;

    // Window menu
    NSMenuItem *winItem = [[NSMenuItem alloc] init];
    [mainMenu addItem:winItem];
    NSMenu *winMenu = [[NSMenu alloc] initWithTitle:@"窗口"];
    [winMenu addItemWithTitle:@"最小化" action:@selector(performMiniaturize:) keyEquivalent:@"m"];
    [winMenu addItemWithTitle:@"缩放" action:@selector(performZoom:) keyEquivalent:@""];
    winItem.submenu = winMenu;

    [NSApp setMainMenu:mainMenu];
}

- (void)reloadPage { [self.webView reload]; }
- (void)goBack { if (self.webView.canGoBack) [self.webView goBack]; }
- (void)goForward { if (self.webView.canGoForward) [self.webView goForward]; }
- (void)goHome {
    if (self.serverURL) {
        [self.webView loadRequest:[NSURLRequest requestWithURL:self.serverURL]];
    }
}
- (void)openDataFolder {
    NSString *dataDir = [self.projectDir stringByAppendingPathComponent:@"data"];
    [[NSWorkspace sharedWorkspace] openURL:[NSURL fileURLWithPath:dataDir]];
}
- (void)openInBrowser {
    if (self.serverURL) {
        [[NSWorkspace sharedWorkspace] openURL:self.serverURL];
    }
}

#pragma mark - Server Discovery & Startup

- (NSString *)resolveProjectDir {
    NSFileManager *fm = [NSFileManager defaultManager];
    NSDictionary *env = [[NSProcessInfo processInfo] environment];
    NSString *envDir = env[@"QINGSONG_DIR"];
    if (envDir.length && [fm fileExistsAtPath:[envDir stringByAppendingPathComponent:@"server.mjs"]]) {
        return envDir;
    }
    NSString *plistDir = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"QingsongProjectDir"];
    if ([plistDir isKindOfClass:[NSString class]] && plistDir.length &&
        [fm fileExistsAtPath:[plistDir stringByAppendingPathComponent:@"server.mjs"]]) {
        return plistDir;
    }
    NSString *bundleParent = [[[NSBundle mainBundle] bundlePath] stringByDeletingLastPathComponent];
    NSArray<NSString *> *candidates = @[
        [bundleParent stringByDeletingLastPathComponent],
        bundleParent,
        [NSHomeDirectory() stringByAppendingPathComponent:@"Desktop/study/wechat-schedule"]
    ];
    for (NSString *dir in candidates) {
        if ([fm fileExistsAtPath:[dir stringByAppendingPathComponent:@"server.mjs"]]) {
            return dir;
        }
    }
    return bundleParent;
}

- (NSString *)findNodeBinary {
    NSFileManager *fm = [NSFileManager defaultManager];
    NSString *home = NSHomeDirectory();
    NSArray<NSString *> *candidates = @[
        [home stringByAppendingPathComponent:@".local/bin/node"],
        @"/opt/homebrew/bin/node",
        @"/usr/local/bin/node",
        [home stringByAppendingPathComponent:@".dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node"],
        @"/usr/bin/node"
    ];
    for (NSString *p in candidates) {
        if ([fm isExecutableFileAtPath:p]) return p;
    }
    return nil;
}

- (NSURL *)findRunningServer {
    NSURLSessionConfiguration *cfg = [NSURLSessionConfiguration ephemeralSessionConfiguration];
    cfg.timeoutIntervalForRequest = 0.8;
    NSURLSession *session = [NSURLSession sessionWithConfiguration:cfg];

    for (int offset = 0; offset < 20; offset++) {
        int port = 7788 + offset;
        NSString *urlStr = [NSString stringWithFormat:@"http://127.0.0.1:%d/api/state", port];
        NSURL *stateURL = [NSURL URLWithString:urlStr];
        dispatch_semaphore_t sem = dispatch_semaphore_create(0);
        __block BOOL matched = NO;

        NSURLSessionDataTask *task = [session dataTaskWithURL:stateURL completionHandler:^(NSData *data, NSURLResponse *resp, NSError *err) {
            NSHTTPURLResponse *http = (NSHTTPURLResponse *)resp;
            if (!err && http.statusCode == 200 && data) {
                id obj = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
                if ([obj isKindOfClass:[NSDictionary class]] && obj[@"settings"] && obj[@"env"]) {
                    matched = YES;
                }
            }
            dispatch_semaphore_signal(sem);
        }];
        [task resume];
        dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1.0 * NSEC_PER_SEC)));
        if (matched) {
            return [NSURL URLWithString:[NSString stringWithFormat:@"http://127.0.0.1:%d", port]];
        }
    }
    return nil;
}

- (NSURL *)launchLocalServerError:(NSError **)outError {
    NSString *entry = [self.projectDir stringByAppendingPathComponent:@"server.mjs"];
    if (![[NSFileManager defaultManager] fileExistsAtPath:entry]) {
        if (outError) {
            *outError = [NSError errorWithDomain:@"QingsongRili" code:1 userInfo:@{
                NSLocalizedDescriptionKey: [NSString stringWithFormat:@"未找到 server.mjs（目录：%@）", self.projectDir]
            }];
        }
        return nil;
    }
    NSString *nodePath = [self findNodeBinary];
    if (!nodePath) {
        if (outError) {
            *outError = [NSError errorWithDomain:@"QingsongRili" code:2 userInfo:@{
                NSLocalizedDescriptionKey: @"未找到 Node.js，请先安装 Node.js 18+"
            }];
        }
        return nil;
    }

    NSTask *task = [[NSTask alloc] init];
    task.executableURL = [NSURL fileURLWithPath:nodePath];
    task.arguments = @[entry];
    task.currentDirectoryURL = [NSURL fileURLWithPath:self.projectDir];

    NSMutableDictionary *env = [NSMutableDictionary dictionaryWithDictionary:[[NSProcessInfo processInfo] environment]];
    NSString *home = NSHomeDirectory();
    NSArray<NSString *> *extra = @[
        [home stringByAppendingPathComponent:@".local/bin"],
        @"/opt/homebrew/bin",
        @"/usr/local/bin",
        @"/usr/bin",
        @"/bin",
        @"/usr/sbin",
        @"/sbin"
    ];
    NSString *oldPath = env[@"PATH"] ?: @"";
    env[@"PATH"] = oldPath.length
        ? [NSString stringWithFormat:@"%@:%@", [extra componentsJoinedByString:@":"], oldPath]
        : [extra componentsJoinedByString:@":"];
    env[@"NO_OPEN"] = @"1";
    task.environment = env;

    NSPipe *pipe = [NSPipe pipe];
    task.standardOutput = pipe;
    task.standardError = pipe;

    if (![task launchAndReturnError:outError]) {
        return nil;
    }
    self.serverTask = task;
    self.ownsServer = YES;

    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    __block NSURL *detected = nil;
    NSMutableString *acc = [NSMutableString string];
    NSRegularExpression *regex = [NSRegularExpression regularExpressionWithPattern:@"http://127\\.0\\.0\\.1:(\\d{2,5})" options:0 error:nil];

    pipe.fileHandleForReading.readabilityHandler = ^(NSFileHandle *handle) {
        NSData *data = [handle availableData];
        if (data.length == 0) {
            handle.readabilityHandler = nil;
            dispatch_semaphore_signal(sem);
            return;
        }
        NSString *chunk = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
        if (!chunk) return;
        @synchronized (acc) {
            [acc appendString:chunk];
            if (!detected) {
                NSTextCheckingResult *m = [regex firstMatchInString:acc options:0 range:NSMakeRange(0, acc.length)];
                if (m) {
                    NSString *found = [acc substringWithRange:m.range];
                    detected = [NSURL URLWithString:found];
                    handle.readabilityHandler = nil;
                    dispatch_semaphore_signal(sem);
                }
            }
        }
    };

    dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, (int64_t)(15.0 * NSEC_PER_SEC)));
    pipe.fileHandleForReading.readabilityHandler = nil;

    if (detected) return detected;
    NSURL *polled = [self findRunningServer];
    if (polled) return polled;

    if (outError) {
        *outError = [NSError errorWithDomain:@"QingsongRili" code:3 userInfo:@{
            NSLocalizedDescriptionKey: @"本地服务启动超时，请检查端口或 Node.js 环境"
        }];
    }
    return nil;
}

- (void)bootstrapServer {
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        NSURL *existing = [self findRunningServer];
        if (existing) {
            self.ownsServer = NO;
            self.serverURL = existing;
            dispatch_async(dispatch_get_main_queue(), ^{
                [self.webView loadRequest:[NSURLRequest requestWithURL:existing]];
            });
            return;
        }

        NSError *err = nil;
        NSURL *started = [self launchLocalServerError:&err];
        if (started) {
            self.serverURL = started;
            dispatch_async(dispatch_get_main_queue(), ^{
                [self.webView loadRequest:[NSURLRequest requestWithURL:started]];
            });
        } else {
            NSString *msg = err ? [NSString stringWithFormat:@"启动失败：%@", err.localizedDescription] : @"启动失败";
            dispatch_async(dispatch_get_main_queue(), ^{
                [self showSplash:msg isError:YES];
            });
        }
    });
}

- (void)stopOwnedServer {
    if (self.ownsServer && self.serverTask && self.serverTask.isRunning) {
        [self.serverTask terminate];
        self.serverTask = nil;
    }
}

- (void)showSplash:(NSString *)message isError:(BOOL)isError {
    NSString *color = isError ? @"#d9382e" : @"#3b87d6";
    NSString *esc = [[message stringByReplacingOccurrencesOfString:@"&" withString:@"&amp;"]
                     stringByReplacingOccurrencesOfString:@"<" withString:@"&lt;"];
    NSString *html = [NSString stringWithFormat:
        @"<!doctype html><html lang='zh-CN'><head><meta charset='utf-8'><style>"
        "body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;"
        "background:#f3eeee;font-family:-apple-system,'PingFang SC',sans-serif;color:#222;}"
        ".box{background:#fff;padding:28px 34px;border-radius:18px;box-shadow:0 6px 24px rgba(0,0,0,.08);text-align:center;max-width:460px;}"
        "h1{margin:0 0 10px;font-size:22px;color:#3b87d6;}"
        "p{margin:0;font-size:14px;color:%@;line-height:1.6;}"
        "</style></head><body><div class='box'><h1>轻松日程</h1><p>%@</p></div></body></html>",
        color, esc];
    [self.webView loadHTMLString:html baseURL:nil];
}

#pragma mark - WKNavigationDelegate & WKUIDelegate

- (BOOL)isInternalURL:(NSURL *)url {
    NSString *host = url.host.lowercaseString;
    return [host isEqualToString:@"127.0.0.1"] || [host isEqualToString:@"localhost"];
}

- (void)webView:(WKWebView *)webView decidePolicyForNavigationAction:(WKNavigationAction *)navigationAction decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
    NSURL *url = navigationAction.request.URL;
    if (url && ([url.scheme isEqualToString:@"http"] || [url.scheme isEqualToString:@"https"]) && ![self isInternalURL:url]) {
        [[NSWorkspace sharedWorkspace] openURL:url];
        decisionHandler(WKNavigationActionPolicyCancel);
        return;
    }
    decisionHandler(WKNavigationActionPolicyAllow);
}

- (WKWebView *)webView:(WKWebView *)webView createWebViewWithConfiguration:(WKWebViewConfiguration *)configuration forNavigationAction:(WKNavigationAction *)navigationAction windowFeatures:(WKWindowFeatures *)windowFeatures {
    NSURL *url = navigationAction.request.URL;
    if (url) {
        if ([self isInternalURL:url]) {
            [webView loadRequest:[NSURLRequest requestWithURL:url]];
        } else {
            [[NSWorkspace sharedWorkspace] openURL:url];
        }
    }
    return nil;
}

- (void)webView:(WKWebView *)webView runJavaScriptAlertPanelWithMessage:(NSString *)message initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(void))completionHandler {
    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = @"轻松日程";
    alert.informativeText = message ?: @"";
    [alert addButtonWithTitle:@"知道了"];
    [alert beginSheetModalForWindow:self.window completionHandler:^(__unused NSModalResponse r) {
        completionHandler();
    }];
}

- (void)webView:(WKWebView *)webView runJavaScriptConfirmPanelWithMessage:(NSString *)message initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(BOOL))completionHandler {
    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = @"轻松日程";
    alert.informativeText = message ?: @"";
    [alert addButtonWithTitle:@"确定"];
    [alert addButtonWithTitle:@"取消"];
    [alert beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse r) {
        completionHandler(r == NSAlertFirstButtonReturn);
    }];
}

@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSApplication *app = [NSApplication sharedApplication];
        [app setActivationPolicy:NSApplicationActivationPolicyRegular];
        QingsongAppDelegate *delegate = [[QingsongAppDelegate alloc] init];
        app.delegate = delegate;
        [app run];
    }
    return 0;
}
