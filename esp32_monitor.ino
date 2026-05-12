/*
  VitalHub Hospital System - ESP32 Integration
  Supports both:
  1. BLE (Bluetooth Low Energy) for App connection
  2. WiFi (HTTP POST) for direct cloud logging
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// Configuration
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";
const char* serverUrl = "http://YOUR_SERVER_IP:5000/api/esp32/reading";
const char* apiKey = "esp32-secret-123";

// BLE UUIDs (Matches React App)
#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"

BLECharacteristic *pCharacteristic;
bool deviceConnected = false;

class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
      deviceConnected = true;
    };
    void onDisconnect(BLEServer* pServer) {
      deviceConnected = false;
      pServer->getAdvertising()->start();
    }
};

void setup() {
  Serial.begin(115200);

  // 1. Setup BLE
  BLEDevice::init("ESP32-devkit-v1");
  BLEServer *pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());
  BLEService *pService = pServer->createService(SERVICE_UUID);
  pCharacteristic = pService->createCharacteristic(
                      CHARACTERISTIC_UUID,
                      BLECharacteristic::PROPERTY_READ |
                      BLECharacteristic::PROPERTY_WRITE |
                      BLECharacteristic::PROPERTY_NOTIFY
                    );
  pCharacteristic->addDescriptor(new BLE2902());
  pService->start();
  pServer->getAdvertising()->start();
  Serial.println("BLE Ready: Waiting for app connection...");

  // 2. Setup WiFi
  WiFi.begin(ssid, password);
}

void sendDataWiFi(int sys, int dia, int pulse) {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(serverUrl);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-API-Key", apiKey);

    String json = "{\"systolic\":" + String(sys) + 
                  ",\"diastolic\":" + String(dia) + 
                  ",\"pulse\":" + String(pulse) + 
                  ",\"patientName\":\"ESP32_Device\"}";
    
    int httpResponseCode = http.POST(json);
    Serial.print("WiFi Send Status: ");
    Serial.println(httpResponseCode);
    http.end();
  }
}

void loop() {
  // Simulate a reading every 20 seconds (In real use, trigger this with a button)
  static unsigned long lastMillis = 0;
  if (millis() - lastMillis > 20000) {
    int sys = 120 + random(0, 10);
    int dia = 80 + random(0, 5);
    int pulse = 70 + random(0, 5);

    // Path A: BLE (Update connected app)
    if (deviceConnected) {
      String data = String(sys) + "," + String(dia) + "," + String(pulse);
      pCharacteristic->setValue(data.c_str());
      pCharacteristic->notify();
      Serial.println("Sent via BLE: " + data);
    }

    // Path B: WiFi (Direct to database)
    sendDataWiFi(sys, dia, pulse);
    
    lastMillis = millis();
  }
}
