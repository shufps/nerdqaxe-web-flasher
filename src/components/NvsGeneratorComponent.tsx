// NvsGeneratorComponent.tsx
import React, { useState, useCallback } from 'react';
import { generateNvsBlobFromCsv } from './nvs_generator'; // Import the core logic

// Default CSV content for convenience
const defaultCsvContent = `key,type,encoding,value
main,namespace,,

# ─────────────────────────────────────────────────────────────────────────────
# ↓↓↓ NETWORK & STRATUM CONFIG – Must override when using config file ↓↓↓
# These values are also available in menuconfig (Kconfig), but are meant to be
# overridden here when provisioning or deploying individual devices.
# ─────────────────────────────────────────────────────────────────────────────

# Device hostname on the local network
hostname,data,string,bitaxe

# Wi-Fi SSID – name of your wireless network
wifissid,data,string,myssid

# Wi-Fi password – yep, plain text (use secure provisioning if possible!)
wifipass,data,string,mypass

# Stratum server URL – mining pool or stratum proxy
stratumurl,data,string,public-pool.io

# Stratum port – usually defined by your pool (default varies)
stratumport,data,u16,21496

# Stratum username – usually your wallet address + optional worker ID
stratumuser,data,string,bc1q29hp4fqtks2wzpmfwtpac64fnr8ujw2nvnra04.nerdqaxe

# Stratum password – often just "x"
stratumpass,data,string,x

# Initial suggested Stratum difficulty
stratumdiff,data,u64,1000

# ─── Optional fallback configuration (enabled only if defined) ────────────────

# Fallback Stratum server URL – used if primary connection fails
#fbstratumurl,data,string,backup-pool.io

# Fallback Stratum port – typically same as primary
#fbstratumport,data,u16,21496

# Fallback Stratum user – can match primary or use a backup worker ID
#fbstratumuser,data,string,bc1q29hp4fqtks2wzpmfwtpac64fnr8ujw2nvnra04.backupaxe

# Fallback Stratum password – usually same as primary
#fbstratumpass,data,string,x

# ─────────────────────────────────────────────────────────────────────────────
# ↓↓↓ BOARD-DEPENDENT SETTINGS – Already tuned per board, no need to touch ↓↓↓
# These values have sensible defaults tailored to each supported board.
# Unless you're debugging or optimizing for edge cases, just leave them be.
# ─────────────────────────────────────────────────────────────────────────────

# Default ASIC frequency in MHz – tweak for performance or efficiency
#asicfrequency,data,u16,485

# Default ASIC core voltage in mV – be cautious, this affects stability & heat
#asicvoltage,data,u16,1200

# Interval (ms) between jobs sent to ASIC – smaller = faster job switching
#asicjobinterval,data,u16,1200

# Flip screen orientation – 0: normal, 1: rotated
#flipscreen,data,u16,0

# Invert fan control signal polarity – set to 1 if fan behaves weirdly
#invertfanpol,data,u16,0

# ─────────────────────────────────────────────────────────────────────────────
# ↓↓↓ MENUCONFIG DEFAULTS – Board-independent, set via Kconfig at build time ↓↓↓
# These values come from your firmware's Kconfig (menuconfig) setup.
# They're consistent across boards unless explicitly overridden.
# ─────────────────────────────────────────────────────────────────────────────

# Enable automatic fan speed control – 1: on, 0: manual
#autofanspeed,data,u16,0

# Manual fan speed in % (if autofanspeed = 0)
#fanspeed,data,u16,100

# Run ASIC self-test on startup – 1: yes, 0: no
#selftest,data,u16,0

# Temperature threshold (°C) to trigger thermal protection
#overheat_temp,data,u16,70

# Automatically turn off screen – 1: on, 0: nff
#autoscreenoff,data,u16,0

# ─────────────────────────────────────────────────────────────────────────────
# ↓↓↓ INFLUXDB TELEMETRY SETTINGS – Enable and configure stats reporting ↓↓↓
# ─────────────────────────────────────────────────────────────────────────────

# Enable stats upload to InfluxDB – 1: enable, 0: disable
#influx_enable,data,u16,0

# InfluxDB server URL (no trailing slash)
#influx_url,data,string,http://192.168.0.123

# InfluxDB HTTP API port (default: 8086)
#influx_port,data,u16,8086

# InfluxDB access token (default is the same as used by the monitoring docker setup)
#influx_token,data,string,f37fh783hf8hq

# InfluxDB bucket name – where your data lands
#influx_bucket,data,string,nerdqaxeplus

# InfluxDB organization name – required for v2 API
#influx_org,data,string,nerdqaxeplus

# Measurement prefix – helps identify data source in dashboards
#influx_prefix,data,string,mainnet_stats`;

const NvsGeneratorComponent: React.FC = () => {
    const [csvContent, setCsvContent] = useState<string>(defaultCsvContent);
    const [partitionSize, setPartitionSize] = useState<string>('12288'); // Default size
    const [outputFilename, setOutputFilename] = useState<string>('config.bin');
    const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [generating, setGenerating] = useState<boolean>(false);

    const handleGenerate = useCallback(async () => {
        setError(null);
        setDownloadUrl(null); // Clear previous download link
        setGenerating(true);

        // Clean up any existing blob URL to prevent memory leaks
        if (downloadUrl) {
            URL.revokeObjectURL(downloadUrl);
        }

        try {
            console.log("Calling generateNvsBlobFromCsv...");
            const blob = await generateNvsBlobFromCsv(csvContent, partitionSize);
            const url = URL.createObjectURL(blob);
            setDownloadUrl(url);
            console.log("Blob URL created:", url);
        } catch (err) {
            console.error("Generation failed:", err);
            if (err instanceof Error) {
                setError(`Generation failed: ${err.message}`);
            } else {
                setError('An unknown error occurred during generation.');
            }
        } finally {
            setGenerating(false);
        }
    }, [csvContent, partitionSize, downloadUrl]); // Include downloadUrl in deps for revokeObjectURL

    // Effect to clean up URL when component unmounts or URL changes
    React.useEffect(() => {
        return () => {
            if (downloadUrl) {
                URL.revokeObjectURL(downloadUrl);
                console.log("Blob URL revoked on cleanup:", downloadUrl);
            }
        };
    }, [downloadUrl]);


    const handleCsvChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        setCsvContent(event.target.value);
        setError(null); // Clear error on input change
        setDownloadUrl(null); // Clear download link on input change
    };

    const handleSizeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setPartitionSize(event.target.value);
        setError(null);
        setDownloadUrl(null);
    };

     const handleFilenameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setOutputFilename(event.target.value || 'nvs_partition.bin'); // Ensure a default filename
        setError(null);
    };


    return (
        <div style={{ fontFamily: 'sans-serif', maxWidth: '800px', margin: '20px auto', padding: '20px', border: '1px solid #ccc', borderRadius: '8px' }}>
            <h2>ESP-IDF NVS Partition Generator (V2)</h2>

            <div style={{ marginBottom: '15px' }}>
                <label htmlFor="csvInput" style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                    CSV Configuration Data:
                </label>
                <textarea
                    id="csvInput"
                    value={csvContent}
                    onChange={handleCsvChange}
                    rows={15}
                    style={{ width: '98%', padding: '8px', border: '1px solid #ccc', borderRadius: '4px', fontFamily: 'monospace' }}
                    placeholder="key,type,encoding,value..."
                />
            </div>

            <div style={{ marginBottom: '15px', display: 'flex', gap: '15px', alignItems: 'center' }}>
                 <div>
                    <label htmlFor="partitionSize" style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                        Partition Size (bytes):
                    </label>
                    <input
                        id="partitionSize"
                        type="text"
                        value={partitionSize}
                        onChange={handleSizeChange}
                        style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px', width: '150px' }}
                        placeholder="e.g., 12288 or 0x3000"
                    />
                    <small style={{ display: 'block', color: '#555', marginTop: '3px' }}>Must be multiple of 4096, min 12288.</small>
                 </div>
                 <div>
                     <label htmlFor="outputFilename" style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                         Output Filename:
                     </label>
                     <input
                         id="outputFilename"
                         type="text"
                         value={outputFilename}
                         onChange={handleFilenameChange}
                         style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px', width: '200px' }}
                         placeholder="config.bin"
                     />
                 </div>
            </div>


            <button
                onClick={handleGenerate}
                disabled={generating}
                style={{
                    padding: '10px 15px',
                    fontSize: '16px',
                    cursor: generating ? 'wait' : 'pointer',
                    backgroundColor: generating ? '#ccc' : '#007bff',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    marginRight: '10px'
                }}
            >
                {generating ? 'Generating...' : 'Generate NVS Binary'}
            </button>

            {error && (
                <div style={{ color: 'red', marginTop: '15px', whiteSpace: 'pre-wrap', border: '1px solid red', padding: '10px', borderRadius: '4px', background: '#ffebee' }}>
                    <strong>Error:</strong> {error}
                </div>
            )}

            {downloadUrl && (
                <div style={{ marginTop: '20px' }}>
                    <p style={{ fontWeight: 'bold', color: 'green' }}>Binary generated successfully!</p>
                    <a
                        href={downloadUrl}
                        download={outputFilename} // Use state for filename
                        style={{
                            display: 'inline-block',
                            padding: '10px 15px',
                            backgroundColor: '#28a745',
                            color: 'white',
                            textDecoration: 'none',
                            borderRadius: '4px'
                        }}
                    >
                        Download "{outputFilename}"
                    </a>
                     <p style={{marginTop: '10px', color: '#555'}}>
                         <small>You can verify the downloaded binary using a hex editor or compare it with the output from the original Python script.</small>
                     </p>
                </div>
            )}
        </div>
    );
};

export default NvsGeneratorComponent;