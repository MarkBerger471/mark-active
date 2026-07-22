#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// Exposes LiveActivityPlugin.swift to JavaScript as `Capacitor.Plugins.LiveActivity`.
// Add this file to the APP target.
CAP_PLUGIN(LiveActivityPlugin, "LiveActivity",
  CAP_PLUGIN_METHOD(start, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(end, CAPPluginReturnPromise);
)
