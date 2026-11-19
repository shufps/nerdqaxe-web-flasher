'use client'

import { useState, useEffect, useRef } from 'react'
import { ComputerIcon, Download, Usb, Zap } from 'lucide-react'
import { Button } from './ui/button'
import { ESPLoader, Transport } from 'esptool-js'
import { useTranslation } from 'react-i18next'
import Header from './Header'
import InstructionPanel from './InstructionPanel'
import Selector from './Selector'
import FirmwareVariantToggle, { FirmwareVariant } from './FirmwareVariantToggle'
import RustInfoDialog from './RustInfoDialog'
import device_data from './firmware_data.json'

import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

const RUST_INFO_SEEN_KEY = 'rustInfoSeen';

export default function LandingHero() {
  const { t } = useTranslation();
  const [selectedDevice, setSelectedDevice] = useState<string>('')
  const [selectedFirmware, setSelectedFirmware] = useState('')
  const [firmwareOptions, setFirmwareOptions] = useState<any[]>([]);
  const [status, setStatus] = useState('')
  const [isConnecting, setIsConnecting] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [isFlashing, setIsFlashing] = useState(false)
  const [isLogging, setIsLogging] = useState(false)
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [isChromiumBased, setIsChromiumBased] = useState(true)
  const serialPortRef = useRef<any>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const terminalContainerRef = useRef<HTMLDivElement>(null)
  const readerRef = useRef<ReadableStreamDefaultReader | null>(null)
  const textDecoderRef = useRef<TextDecoderStream | null>(null)
  const readableStreamClosedRef = useRef<Promise<void> | null>(null)
  const logsRef = useRef<string>('')
  const [keepConfig, setKeepConfig] = useState(true);
  const [showPreReleases, setShowPreReleases] = useState(false);
  const [selectedVariant, setSelectedVariant] = useState('cpp');
  const [isRustInfoOpen, setIsRustInfoOpen] = useState(false);
  const [isLoadingReleases, setIsLoadingReleases] = useState(false);

  const device = device_data.devices.find((d) => d.name === selectedDevice);
  const deviceVariants: FirmwareVariant[] = device
    ? device_data.variants.filter((v) => device.variants.includes(v.id))
    : [];
  const variant = deviceVariants.find((v) => v.id === selectedVariant) ?? deviceVariants[0];
  const rustVariant = device_data.variants.find((v) => v.id === 'rust');

  useEffect(() => {
    const userAgent = navigator.userAgent.toLowerCase();
    const isChromium = /chrome|chromium|crios|edge/i.test(userAgent);
    setIsChromiumBased(isChromium);
  }, []);

  useEffect(() => {
    if (terminalContainerRef.current && !terminalRef.current && isLogging) {
      const term = new Terminal({
        cols: 80,
        rows: 24,
        theme: {
          background: '#1a1b26',
          foreground: '#a9b1d6'
        }
      });
      terminalRef.current = term;
      term.open(terminalContainerRef.current);
      term.writeln(t('status.loggingStarted'));
      logsRef.current = t('status.loggingStarted') + '\n';
    }

    return () => {
      if (terminalRef.current) {
        terminalRef.current.dispose();
        terminalRef.current = null;
      }
    };
  }, [isLogging, t]);

  // Helper function to extract GitHub repository details
  const parseGitHubRepo = (repositoryUrl: string) => {
    const repoMatch = repositoryUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!repoMatch) throw new Error('Invalid repository URL');
    const [_, owner, repo] = repoMatch;
    return { owner, repo };
  };

  // Helper function to fetch data from GitHub API
  const fetchGitHubAPI = async (url: string) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
    return response.json();
  };

  const calculateSHA256 = async (data: ArrayBuffer) => {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  };

  // Fetch filtered releases from GitHub.
  // If showPreReleases is true, we only filter out drafts.
  const fetchReleases = async (repositoryUrl: string, selectedDevice: string) => {
    try {
      const { owner, repo } = parseGitHubRepo(repositoryUrl);
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases`;
      const releases = await fetchGitHubAPI(apiUrl);

      const filteredReleases = showPreReleases
        ? releases.filter((release: any) => !release.draft)
        : releases.filter((release: any) => !release.prerelease && !release.draft);

      return filteredReleases.map((release: any) => ({
        version: release.tag_name,
        name: release.name,
        assets: release.assets.filter((asset: any) =>
          asset.name.toLowerCase().startsWith(
            `esp-miner-factory-${selectedDevice.toLowerCase()}-${release.tag_name}`.toLowerCase()
          ),
        ),
      })).filter((release: any) => release.assets.length > 0);
    } catch (error) {
      console.error('Error fetching releases:', error);
      return [];
    }
  };

  // Update firmware options whenever the selected device, variant or showPreReleases changes.
  // The selected version is reset, so a version of one variant is never flashed
  // from the other variant's release list.
  useEffect(() => {
    let cancelled = false;
    setSelectedFirmware('');
    setFirmwareOptions([]);

    const updateFirmwareOptions = async () => {
      if (!device || !variant) {
        setIsLoadingReleases(false);
        return;
      }

      setIsLoadingReleases(true);
      const firmwareData = await fetchReleases(variant.repository, device.file);
      if (!cancelled) {
        setFirmwareOptions(firmwareData);
        setIsLoadingReleases(false);
      }
    };

    updateFirmwareOptions();
    return () => {
      cancelled = true;
    };
  }, [selectedDevice, variant?.id, showPreReleases]);

  const handleVariantChange = (variantId: string) => {
    setSelectedVariant(variantId);
    if (variantId !== 'rust') return;

    // Show the Rust info once, the first time Rust is picked
    let seen = false;
    try {
      seen = localStorage.getItem(RUST_INFO_SEEN_KEY) === '1';
      localStorage.setItem(RUST_INFO_SEEN_KEY, '1');
    } catch {
      // storage not available, show the info every time
    }
    if (!seen) setIsRustInfoOpen(true);
  };

  const handleConnect = async () => {
    setIsConnecting(true)
    setStatus(t('status.connecting'))

    try {
      const port = await navigator.serial.requestPort()
      await port.open({
        baudRate: 115200,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        flowControl: 'none'
      })

      serialPortRef.current = port
      setIsConnected(true)
      setStatus(t('status.connected'))
    } catch (error) {
      console.error('Connection failed:', error)
      setStatus(`${t('status.connectionFailed')}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setIsConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    if (isLogging) {
      await stopSerialLogging();
    }
    try {
      if (serialPortRef.current?.readable) {
        await serialPortRef.current.close();
      }
      serialPortRef.current = null;
      setIsConnected(false)
      setStatus("")
    } catch (error) {
      console.error('Disconnect error:', error);
      setStatus(`${t('status.disconnectError')}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const handleKeepConfigToggle = (event: React.ChangeEvent<HTMLInputElement>) => {
    setKeepConfig(event.target.checked);
  };

  // New handler for toggling "Show Pre-Releases"
  const handleShowPreReleasesToggle = (event: React.ChangeEvent<HTMLInputElement>) => {
    setShowPreReleases(event.target.checked);
  };

  const startSerialLogging = async () => {
    if (!serialPortRef.current) {
      setStatus(t('status.connectFirst'));
      return;
    }

    try {
      setIsLogging(true);
      const port = serialPortRef.current;

      // First ensure any existing connections are cleaned up
      if (readerRef.current) {
        await readerRef.current.cancel();
      }
      if (readableStreamClosedRef.current) {
        await readableStreamClosedRef.current;
      }

      // Set up text decoder stream
      const decoder = new TextDecoderStream();
      const inputDone = port.readable.pipeTo(decoder.writable);
      const inputStream = decoder.readable;
      const reader = inputStream.getReader();

      textDecoderRef.current = decoder;
      readableStreamClosedRef.current = inputDone;
      readerRef.current = reader;

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            reader.releaseLock();
            break;
          }
          terminalRef.current?.write(value);
          logsRef.current += value;
        }
      } catch (error) {
        console.error('Error in read loop:', error);
      }
    } catch (error) {
      console.error('Serial logging error:', error);
      setStatus(`${t('status.loggingError')}: ${error instanceof Error ? error.message : String(error)}`);
    }
    setIsLogging(false);
  };

  const stopSerialLogging = async () => {
    try {
      if (readerRef.current) {
        await readerRef.current.cancel();
        readerRef.current = null;
      }
      if (readableStreamClosedRef.current) {
        await readableStreamClosedRef.current;
        readableStreamClosedRef.current = null;
      }
      if (textDecoderRef.current) {
        textDecoderRef.current = null;
      }
    } catch (error) {
      console.error('Error stopping serial logging:', error);
    } finally {
      setIsLogging(false);
    }
  };

  const downloadLogs = () => {
    const blob = new Blob([logsRef.current], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    a.href = url;
    a.download = `bitaxe-logs-${timestamp}.txt`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  const handleStartFlashing = async () => {
    if (!serialPortRef.current) {
      setStatus(t('status.connectFirst'))
      return
    }

    if (!selectedFirmware) {
      setStatus(t('status.selectFirmware'));
      return;
    }

    const firmwareData = firmwareOptions.find(f => f.version === selectedFirmware);
    if (!firmwareData || firmwareData.assets.length === 0 || !variant?.r2BaseUrl) {
      setStatus(t('status.firmwareNotFound'));
      return;
    }

    setIsFlashing(true)
    setStatus(t('status.preparing'));

    try {
      // Stop logging if it's active
      if (isLogging) {
        await stopSerialLogging();
      }

      // Close the current connection
      if (serialPortRef.current.readable) {
        await serialPortRef.current.close();
      }

      // Create transport and ESPLoader for flashing
      const transport = new Transport(serialPortRef.current);
      const loader = new ESPLoader({
        transport,
        baudrate: 115200,
        romBaudrate: 115200,
        terminal: {
          clean() { },
          // esptool output goes to the browser console to debug connection problems
          writeLine(data: string) {
            console.log(`[esptool] ${data}`);
          },
          write(data: string) {
            console.log(`[esptool] ${data}`);
          },
        },
      });

      await loader.main();

      // Construct R2 download URL instead of using GitHub + corsproxy
      // We added a SHA-256 hash verification step to validate the integrity of
      // the downloaded binary. This step compares its hash against the (hidden)
      // hashes provided on the GitHub release page for each factory file.
      // This ensures that the files on R2 are what was generated in the github workflow.
      const firmwareUrl = firmwareData.assets[0].browser_download_url;
      const binaryName = decodeURIComponent(firmwareUrl.split('/').pop()); // e.g. esp-miner-factory-NerdAxe-v1.0.29.1.bin
      // each firmware variant has its own R2 bucket
      const r2Url = `${variant.r2BaseUrl}/${selectedFirmware}/${binaryName}`;

      console.log(`Downloading firmware from R2: ${r2Url}`);

      // GitHub computes the sha256 of every release asset and exposes it as
      // asset.digest = "sha256:<hex>" (since 2025-06). It's already part of the
      // asset object fetched in fetchReleases, so no extra API call / body
      // parsing is needed.
      const digest = firmwareData.assets[0].digest as string | undefined;
      const sha256Hash = digest?.startsWith('sha256:') ? digest.slice(7) : null;

      if (sha256Hash) {
        console.log(`Found SHA256 hash: ${sha256Hash}`);
      } else {
        console.warn('No SHA256 hash found');
      }

      setStatus(t('status.downloadFirmware'));

      const firmwareResponse = await fetch(r2Url);
      if (!firmwareResponse.ok) {
        throw new Error(`Failed to download firmware from R2 (status ${firmwareResponse.status})`);
      }

      const firmwareArrayBuffer = await firmwareResponse.arrayBuffer();

      // Compare the calculated hash with the fetched hash
      if (sha256Hash) {
      // Calculate the SHA256 hash of the downloaded binary
        const calculatedHash = await calculateSHA256(firmwareArrayBuffer);
        console.log(`Calculated SHA256 hash of downloaded binary: ${calculatedHash}`);

        if (calculatedHash === sha256Hash) {
          console.log('SHA256 hash verification successful. Binary is valid.');
        } else {
          console.error('SHA256 hash verification failed! Binary may be corrupted or tampered with.');
          throw new Error('Hash verification failed');
        }
      } else {
        // version 1.0.23 and earlier don't have hashes on the release page
        // in this case we warn silently in the console but accept the risk
        console.warn("no SHA256 found on the release page!");
      }

      const firmwareUint8Array = new Uint8Array(firmwareArrayBuffer);
      const firmwareBinaryString = Array.from(firmwareUint8Array, (byte) =>
        String.fromCharCode(byte)
      ).join('');

      setStatus(t('status.flashing', { percent: 0 }));

      // On all Nerd*axe derivatives the same
      // address and length is from the partitions.csv
      const nvsStart = 0x9000;
      const nvsSize = 0x6000;

      let parts;

      if (keepConfig) {
        parts = [
          {
            data: firmwareBinaryString.slice(0, nvsStart), // Data before NVS
            address: 0,
          },
          {
            data: firmwareBinaryString.slice(nvsStart + nvsSize), // Data after NVS
            address: nvsStart + nvsSize,
          },
        ];
      } else {
        parts = [
          {
            data: firmwareBinaryString, // Entire firmware binary
            address: 0,
          },
        ];
      }

      await loader.writeFlash({
        fileArray: parts,
        flashSize: "keep",
        flashMode: "keep",
        flashFreq: "keep",
        eraseAll: false,
        compress: true,
        reportProgress: (fileIndex, written, total) => {
          const percent = Math.round((written / total) * 100)
          if (percent === 100) {
            setStatus(t('status.completed'))
          } else {
            setStatus(t('status.flashing', { percent: percent }))
          }
        },
        calculateMD5Hash: () => '',
      })

      setStatus(t('status.completed'))
      await loader.hardReset()

      setStatus(t('status.success'))
    } catch (error) {
      console.error('Flashing failed:', error)
      setStatus(`${t('status.flashingFailed')}: ${error instanceof Error ? error.message : String(error)}. Please try again.`)
    } finally {
      setIsFlashing(false)
    }
  }

  if (!isChromiumBased) {
    return (
      <div className="container px-4 md:px-6 py-12 text-center">
        <h1 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl lg:text-6xl/none mb-4">
          {t('errors.browserCompatibility.title')}
        </h1>
        <p className="mx-auto max-w-[700px] text-gray-500 md:text-xl dark:text-gray-400">
          {t('errors.browserCompatibility.description')}
        </p>
      </div>
    )
  }

  return (
    <>
      <Header onOpenPanel={() => setIsPanelOpen(true)} />
      <div className="bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 px-4 py-2 text-center text-sm">
        <span className="text-amber-800 dark:text-amber-200">
          Want to flash a Bitaxe device?{' '}
          <a
            href="https://bitaxeorg.github.io/bitaxe-web-flasher/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline hover:text-amber-600 dark:hover:text-amber-400"
          >
            Check the Bitaxe flasher
          </a>
        </span>
      </div>
      <section className="w-full py-12 md:py-24 lg:py-32 xl:py-48">
        <div className="container px-4 md:px-6">
          <div className="flex flex-col items-center space-y-4 text-center">
            <div className="space-y-2">
              <h1 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl lg:text-6xl/none">
                {t('hero.title')}
              </h1>
              <p className="mx-auto max-w-[700px] text-gray-500 md:text-xl dark:text-gray-400">
                {t('hero.description')}
              </p>
              {selectedVariant === 'rust' ? (
                <div className="inline-flex items-center gap-3 rounded-full bg-orange-600 py-1 pl-3 pr-1 text-sm text-white shadow">
                  <button type="button" onClick={() => setIsRustInfoOpen(true)} className="inline-flex items-center gap-2 font-medium hover:underline">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-xs">🦀</span>
                    {t('rustInfo.active')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedVariant('cpp')}
                    disabled={isFlashing}
                    className="rounded-full bg-white/20 px-2 py-0.5 text-xs hover:bg-white/30 disabled:opacity-50"
                  >
                    {t('rustInfo.switchBack')}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsRustInfoOpen(true)}
                  className="inline-flex items-center gap-2 rounded-full border border-orange-300 bg-orange-50 px-3 py-1 text-sm text-orange-800 hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-200 dark:hover:bg-orange-950/70"
                >
                  <span className="rounded-full bg-orange-600 px-2 py-0.5 text-xs font-semibold text-white">{t('rustInfo.new')}</span>
                  🦀 {t('rustInfo.teaser')}
                </button>
              )}
            </div>
            <div className="w-full max-w-sm space-y-2">
              <Button
                className="w-full"
                onClick={isConnected ? handleDisconnect : handleConnect}
                disabled={isConnecting || isFlashing}
              >
                {isConnected ? t('hero.disconnect') : t('hero.connect')}
                <Usb className="ml-2 h-4 w-4" />
              </Button>
              <Selector
                placeholder={t('hero.selectDevice')}
                values={device_data.devices.map((d) => d.name)}
                onValueChange={setSelectedDevice}
              />
              {selectedDevice && deviceVariants.length > 1 && (
                <FirmwareVariantToggle
                  variants={deviceVariants}
                  value={variant?.id ?? ''}
                  onValueChange={handleVariantChange}
                  onShowInfo={() => setIsRustInfoOpen(true)}
                  disabled={isConnecting || isFlashing}
                />
              )}
              {selectedDevice && (
                <Selector
                  // remount to show the placeholder again after the version was reset
                  key={`${selectedDevice}-${variant?.id}-${showPreReleases}`}
                  placeholder={isLoadingReleases ? t('hero.loadingReleases') : t('hero.selectFirmware')}
                  values={firmwareOptions.map((f) => f.version)}
                  value={selectedFirmware}
                  onValueChange={setSelectedFirmware}
                  disabled={isConnecting || isFlashing || isLoadingReleases || firmwareOptions.length === 0}
                />
              )}
              {selectedDevice && !isLoadingReleases && firmwareOptions.length === 0 && (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {showPreReleases ? t('hero.noReleases') : t('hero.noStableReleases')}
                </p>
              )}
              <div className="flex items-center justify-between">
                <div>
                  <input
                    type="checkbox"
                    id="keepConfig"
                    className="cursor-pointer"
                    checked={keepConfig}
                    onChange={handleKeepConfigToggle}
                  />&nbsp;
                  <label htmlFor="keepConfig" className="text-gray-500 dark:text-gray-400 cursor-pointer">
                    {t('hero.keepConfig')}
                  </label>
                </div>
                <div>
                  <input
                    type="checkbox"
                    id="showPreReleases"
                    className="cursor-pointer"
                    checked={showPreReleases}
                    onChange={handleShowPreReleasesToggle}
                  />&nbsp;
                  <label htmlFor="showPreReleases" className="text-gray-500 dark:text-gray-400 cursor-pointer">
                    Show Pre-Releases
                  </label>
                </div>
              </div>
              <Button
                className="w-full"
                onClick={handleStartFlashing}
                disabled={!selectedDevice || !selectedFirmware || isConnecting || isFlashing || !isConnected}
              >
                {isFlashing ? t('hero.flashing') : t('hero.startFlashing')}
                <Zap className="ml-2 h-4 w-4" />
              </Button>
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  onClick={isLogging ? stopSerialLogging : startSerialLogging}
                  disabled={!isConnected || isFlashing}
                >
                  {isLogging ? t('hero.stopLogging') : t('hero.startLogging')}
                  <ComputerIcon className="ml-2 h-4 w-4" />
                </Button>
                <Button
                  className="flex-1"
                  onClick={downloadLogs}
                  disabled={!logsRef.current}
                >
                  {t('hero.downloadLogs')}
                  <Download className="ml-2 h-4 w-4" />
                </Button>
              </div>
              <p className="mx-auto max-w-[400px] text-gray-500 md:text-m dark:text-gray-400">
                {t('hero.loggingDescription')}
              </p>
              {status && <p className="mt-2 text-sm font-medium">{status}</p>}
            </div>
            {isLogging && (
              <div
                ref={terminalContainerRef}
                className="w-full max-w-4xl h-[400px] bg-black rounded-lg overflow-hidden mt-8 border border-gray-700 text-left"
              />
            )}
          </div>
        </div>
      </section>
      <InstructionPanel isOpen={isPanelOpen} onClose={() => setIsPanelOpen(false)} />
      {rustVariant && (
        <RustInfoDialog
          isOpen={isRustInfoOpen}
          onClose={() => setIsRustInfoOpen(false)}
          onTryRust={() => {
            setSelectedVariant('rust');
            setIsRustInfoOpen(false);
          }}
          repository={rustVariant.repository}
          isRustSelected={selectedVariant === 'rust'}
        />
      )}
    </>
  )
}
