// nvs_generator.ts
// Requires: `npm install crc-32 papaparse`
// Or include UMD versions in your HTML.

// nvs_generator.ts
import * as CRC32 from 'crc-32';
import Papa from 'papaparse';    // Using papaparse library

// --- Type Definitions ---
export type NvsValue = string | number | Uint8Array;
export type NvsEncoding =
  | 'u8' | 'i8' | 'u16' | 'i16' | 'u32' | 'i32' | 'u64' | 'i64'
  | 'string' | 'binary' | 'hex2bin' | 'base64';
export type NvsEntryType = 'namespace' | 'data' | 'file';

export interface NvsCsvRow {
    key: string;
    type: NvsEntryType;
    encoding: NvsEncoding;
    value: string; // Value from CSV is always string initially
}

// --- Error Classes ---
class PageFullError extends Error {
    constructor(message = "Page is full") {
        super(message);
        this.name = "PageFullError";
    }
}

class InputError extends Error {
    constructor(message: string) {
        super(`Input Error: ${message}`);
        this.name = "InputError";
    }
}

class InsufficientSizeError extends Error {
    constructor(message: string) {
        super(`Insufficient Size Error: ${message}`);
        this.name = "InsufficientSizeError";
    }
}


// --- Page Class ---
class Page {
    // Item type codes (static readonly ensures they are constants)
    static readonly U8   = 0x01;
    static readonly I8   = 0x11;
    static readonly U16  = 0x02;
    static readonly I16  = 0x12;
    static readonly U32  = 0x04;
    static readonly I32  = 0x14;
    static readonly U64  = 0x08; // Note: JS handles 64-bit ints via BigInt
    static readonly I64  = 0x18;
    static readonly SZ   = 0x21; // Null-terminated string
    static readonly BLOB = 0x41; // Binary Large Object (generic)
    static readonly BLOB_DATA = 0x42; // Chunk of blob data (V2)
    static readonly BLOB_IDX = 0x48; // Index entry for multi-chunk blob (V2)

    // Page constants
    static readonly HEADER_SIZE = 32;
    static readonly BITMAPARRAY_OFFSET = 32;
    static readonly BITMAPARRAY_SIZE_IN_BYTES = 32;
    static readonly FIRST_ENTRY_OFFSET = 64;
    static readonly SINGLE_ENTRY_SIZE = 32;
    static readonly CHUNK_ANY = 0xFF;
    static readonly STATE_ACTIVE = 0xFFFFFFFE;
    static readonly STATE_FULL = 0xFFFFFFFC;
    static readonly VERSION2 = 0xFE; // Hardcoded to V2

    static readonly MAX_SIZE = 4096;
    static readonly MAX_BLOB_SIZE = 4000; // V2 max size for strings
    static readonly MAX_ENTRIES = 126;

    public entryNum = 0;
    public pageBuf: Uint8Array;
    private bitmapArray: Uint8Array;
    private dataView: DataView;

    constructor(pageSeqNum: number, isReservedPage = false) {
        this.pageBuf = new Uint8Array(Page.MAX_SIZE).fill(0xFF);
        this.dataView = new DataView(this.pageBuf.buffer);
        this.bitmapArray = new Uint8Array(Page.BITMAPARRAY_SIZE_IN_BYTES).fill(0xFF);

        if (!isReservedPage) {
            this.setHeader(pageSeqNum);
            // Copy initial (all 1s) bitmap to page buffer
            this.pageBuf.set(this.bitmapArray, Page.BITMAPARRAY_OFFSET);
        }
    }

    private setHeader(pageSeqNum: number): void {
        this.dataView.setUint32(0, Page.STATE_ACTIVE, true); // State (little-endian)
        this.dataView.setUint32(4, pageSeqNum, true);       // Sequence number (little-endian)
        this.pageBuf[8] = Page.VERSION2;                    // Version byte

        // Calculate header CRC (over bytes 4-27)
        const crcData = this.pageBuf.slice(4, 28);
        // crc32 function expects signed int result, convert properly
        const crcValue = CRC32.buf(crcData, -1); // Defaults to 0 seed
        const crcUint32 = crcValue >>> 0; // Convert signed int32 to unsigned int32
        this.dataView.setUint32(28, crcUint32, true);        // CRC (little-endian)
    }

    private writeBitmap(): void {
        const bitNum = this.entryNum * 2;
        const byteIndex = Math.floor(bitNum / 8);
        const bitOffset = bitNum % 8;
        const mask = ~(1 << bitOffset);

        if (byteIndex < this.bitmapArray.length) {
            this.bitmapArray[byteIndex] &= mask;
            // Update the bitmap in the main page buffer
            this.pageBuf.set(this.bitmapArray, Page.BITMAPARRAY_OFFSET);
        } else {
             console.error(`Error: Attempted to write bitmap beyond bounds (byteIndex: ${byteIndex})`);
        }
    }

    // Writes data (header or payload) into the entry space of the page buffer
    writeEntryData(data: Uint8Array, entryCount: number, nvs: NVS): void {
        const dataOffset = Page.FIRST_ENTRY_OFFSET + Page.SINGLE_ENTRY_SIZE * this.entryNum;
        const endOffset = dataOffset + data.length;

        if (endOffset > Page.MAX_SIZE) {
            throw new PageFullError("Data write exceeds page boundary");
        }
        if (this.entryNum + entryCount > Page.MAX_ENTRIES) {
             throw new PageFullError(`Write would exceed max entries (${this.entryNum} + ${entryCount} > ${Page.MAX_ENTRIES})`);
        }

        this.pageBuf.set(data, dataOffset);

        // Update bitmap for each entry occupied
        for (let i = 0; i < entryCount; i++) {
            if (this.entryNum < Page.MAX_ENTRIES) {
                this.writeBitmap();
                this.entryNum++;
            } else {
                 // Should have been caught by the check above
                 throw new PageFullError("Exceeded max entries during multi-entry write");
            }
        }
    }

    // Calculates and sets the CRC for a 32-byte entry header
    setEntryHeaderCrc(entryHeader: Uint8Array): void {
        if (entryHeader.length !== Page.SINGLE_ENTRY_SIZE) {
            throw new Error("Entry header must be 32 bytes");
        }
        // CRC over bytes 0-3 and 8-31
        const crcInput = new Uint8Array(28);
        crcInput.set(entryHeader.slice(0, 4), 0);
        crcInput.set(entryHeader.slice(8, 32), 4);

        const crcValue = CRC32.buf(crcInput, -1); // Defaults to 0 seed
        const crcUint32 = crcValue >>> 0; // Convert signed int32 to unsigned int32

        // Use DataView to write CRC into the header (bytes 4-7)
        const headerView = new DataView(entryHeader.buffer, entryHeader.byteOffset);
        headerView.setUint32(4, crcUint32, true); // little-endian
    }

    // V2 Multipage Blob Handling
    writeVarlenBinaryData(
        entryHeaderTemplate: Uint8Array, // Base header (NS, Type=BLOB, Key)
        data: Uint8Array, // The full binary data
        nvs: NVS
    ): void {
        const dataSize = data.length;
        let remainingSize = dataSize;
        let offset = 0;
        let chunkCount = 0;
        const chunkStart = 0; // Simple: always start chunks at index 0 for a blob

        // Create mutable copy for BLOB_DATA header
        const chunkHeader = new Uint8Array(entryHeaderTemplate);
        const chunkHeaderView = new DataView(chunkHeader.buffer);

        while (remainingSize > 0) {
            let currentPage = nvs.currentPage;
            if (currentPage.entryNum >= Page.MAX_ENTRIES) {
                currentPage = nvs.createNewPage();
            }

            const tailroomEntries = Page.MAX_ENTRIES - currentPage.entryNum;
            if (tailroomEntries <= 1) { // Need >=1 for header, >=1 for data
                currentPage = nvs.createNewPage();
            }
            const maxDataEntries = Page.MAX_ENTRIES - currentPage.entryNum - 1;
            const maxChunkSize = maxDataEntries * Page.SINGLE_ENTRY_SIZE;

            const chunkSize = Math.min(remainingSize, maxChunkSize);
            if (chunkSize <= 0) {
                 console.warn(`Calculated zero chunk size. Remaining: ${remainingSize}, Max data entries: ${maxDataEntries}`);
                 currentPage = nvs.createNewPage(); // Try a fresh page
                 continue;
            }

            const chunkData = data.subarray(offset, offset + chunkSize);

            // --- Prepare BLOB_DATA Header ---
            chunkHeader[1] = Page.BLOB_DATA; // Type
            const chunkIndex = chunkStart + chunkCount;
            chunkHeader[3] = chunkIndex; // Chunk Index

            const dataChunkRoundedSize = (chunkSize + 31) & ~31;
            const dataChunkEntryCount = dataChunkRoundedSize / 32;
            const totalEntryCount = dataChunkEntryCount + 1; // +1 for header
            chunkHeader[2] = totalEntryCount; // Span

            // Data size and CRC for BLOB_DATA
            chunkHeaderView.setUint16(24, chunkSize, true); // Actual data size (little-endian)
            const dataCrc = CRC32.buf(chunkData, -1);
            chunkHeaderView.setUint32(28, dataCrc >>> 0, true); // Data CRC (little-endian)

            // Header CRC
            currentPage.setEntryHeaderCrc(chunkHeader);

            // Write header and data
            currentPage.writeEntryData(chunkHeader, 1, nvs);
            currentPage.writeEntryData(chunkData, dataChunkEntryCount, nvs);

            // Update for next iteration
            remainingSize -= chunkSize;
            offset += chunkSize;
            chunkCount++;

             // If page got filled exactly, next loop iteration will handle new page creation
        }

        // --- Write BLOB_IDX Entry ---
        let indexPage = nvs.currentPage;
        if (indexPage.entryNum >= Page.MAX_ENTRIES) {
             indexPage = nvs.createNewPage();
        }

        const indexHeader = new Uint8Array(entryHeaderTemplate); // Start from original template
        const indexHeaderView = new DataView(indexHeader.buffer);

        indexHeader[1] = Page.BLOB_IDX;    // Type
        indexHeader[2] = 1;                // Span (always 1)
        indexHeader[3] = Page.CHUNK_ANY;   // Chunk Index for IDX

        // Data for BLOB_IDX
        indexHeaderView.setUint32(24, dataSize, true); // Total data size (little-endian)
        indexHeader[28] = chunkCount & 0xFF;           // Number of chunks
        indexHeader[29] = chunkStart & 0xFF;           // Starting chunk index
        // Bytes 30, 31 remain 0xFF (reserved)

        // Header CRC
        indexPage.setEntryHeaderCrc(indexHeader);

        // Write the index entry
        indexPage.writeEntryData(indexHeader, 1, nvs);
    }

     // Writes string or V1 blob (single page only)
     writeSinglePageEntry(
         entryHeader: Uint8Array, // Header with type SZ or BLOB (V1)
         data: Uint8Array, // Data (already null-terminated for SZ)
         dataEntryCount: number,
         nvs: NVS
     ): void {
         const dataLen = data.length;
         const headerView = new DataView(entryHeader.buffer);

         // Data size and CRC
         headerView.setUint16(24, dataLen, true); // little-endian
         const dataCrc = CRC32.buf(data, -1);
         headerView.setUint32(28, dataCrc >>> 0, true); // little-endian

         // Header CRC
         this.setEntryHeaderCrc(entryHeader);

         // Write header and data
         this.writeEntryData(entryHeader, 1, nvs);
         this.writeEntryData(data, dataEntryCount, nvs);
     }


    // High-level function for variable length data (strings, blobs)
    writeVarlenData(
        key: string,
        data: Uint8Array | string, // string for 'string' encoding, Uint8Array otherwise
        encoding: 'string' | 'binary', // Note: hex2bin/base64 converted to 'binary' before calling
        nsIndex: number,
        nvs: NVS
    ): void {
        let dataBytes: Uint8Array;
        const textEncoder = new TextEncoder(); // For converting string to UTF-8 bytes

        if (encoding === 'string') {
            if (typeof data !== 'string') throw new InputError("Data must be a string for 'string' encoding.");
            const utf8Bytes = textEncoder.encode(data);
            dataBytes = new Uint8Array(utf8Bytes.length + 1); // +1 for null terminator
            dataBytes.set(utf8Bytes, 0);
            // Null terminator is already 0 by default initialization if needed, but explicit is safer:
            dataBytes[utf8Bytes.length] = 0;
        } else if (data instanceof Uint8Array) {
            dataBytes = data;
        } else {
            throw new InputError(`Unexpected data type for varlen encoding '${encoding}': ${typeof data}`);
        }

        const dataLen = dataBytes.length;

        // Check string length limit
        if (encoding === 'string' && dataLen > Page.MAX_BLOB_SIZE) {
            throw new InputError(`String size (${dataLen}) exceeds max V2 length ${Page.MAX_BLOB_SIZE} bytes for key '${key}'.`);
        }

        // Calculate initial estimates (may change for multipage)
        const roundedSize = (dataLen + 31) & ~31;
        const dataEntryCount = roundedSize / 32;
        const totalEntryCount = dataEntryCount + 1; // +1 for header

        // Check if page has space for *at least* the header
        if (this.entryNum >= Page.MAX_ENTRIES) {
            throw new PageFullError();
        }
        // If it's a string and won't fit entirely, throw PageFullError
        if (encoding === 'string' && (this.entryNum + totalEntryCount) > Page.MAX_ENTRIES) {
            throw new PageFullError();
        }
        // If it's binary, multipage logic will handle overflow.

        // --- Common Entry Header Setup ---
        const entryHeader = new Uint8Array(Page.SINGLE_ENTRY_SIZE).fill(0xFF);
        const headerView = new DataView(entryHeader.buffer);
        headerView.setUint8(0, nsIndex);      // Namespace Index
        headerView.setUint8(3, Page.CHUNK_ANY); // Default Chunk Index

        // Key (encode, copy, null-terminate)
        const keyBytes = textEncoder.encode(key);
        if (keyBytes.length > 15) throw new InputError(`Key '${key}' exceeds 15 bytes`); // Should be checked earlier
        // Clear the key area first (optional, but ensures no leftover FF)
        entryHeader.fill(0x00, 8, 24); // Zero out bytes 8 through 23
        entryHeader.set(keyBytes, 8);
        // Null terminator is implicitly set by fill(0x00) if keyBytes.length < 15
        // Explicitly set it just in case key is exactly 15 bytes
        if (keyBytes.length <= 15) {
            entryHeader[8 + keyBytes.length] = 0;
        }
        // --- Type-Specific Logic ---
        if (encoding === 'string') {
            entryHeader[1] = Page.SZ;           // Type = String
            entryHeader[2] = totalEntryCount;   // Span
            this.writeSinglePageEntry(entryHeader, dataBytes, dataEntryCount, nvs);
        } else { // binary (includes hex2bin, base64)
            entryHeader[1] = Page.BLOB;         // Type = Blob (initial type for multipage)
            // Span & Chunk Index handled inside writeVarlenBinaryData
            this.writeVarlenBinaryData(entryHeader, dataBytes, nvs);
        }
    }

    // High-level function for primitive types (numbers)
    writePrimitiveData(
        key: string,
        value: number | bigint, // Use bigint for u64/i64
        encoding: NvsEncoding,
        nsIndex: number,
        nvs: NVS
    ): void {
        if (this.entryNum >= Page.MAX_ENTRIES) {
            throw new PageFullError();
        }

        const entryHeader = new Uint8Array(Page.SINGLE_ENTRY_SIZE).fill(0xFF);
        const headerView = new DataView(entryHeader.buffer);

        headerView.setUint8(0, nsIndex);      // Namespace Index
        headerView.setUint8(2, 1);            // Span (always 1)
        headerView.setUint8(3, Page.CHUNK_ANY); // Chunk Index

        // Key
        const textEncoder = new TextEncoder();
        const keyBytes = textEncoder.encode(key);
        if (keyBytes.length > 15) throw new InputError(`Key '${key}' exceeds 15 bytes`);
        // Clear the key area first
        entryHeader.fill(0x00, 8, 24); // Zero out bytes 8 through 23
        entryHeader.set(keyBytes, 8);
        // Null terminator handling
        if (keyBytes.length <= 15) {
            entryHeader[8 + keyBytes.length] = 0;
        }

        // Type and Data Packing
        let typeCode = 0;
        const littleEndian = true;

        try {
            switch (encoding) {
                case 'u8':  typeCode = Page.U8;  headerView.setUint8(24, value as number); break;
                case 'i8':  typeCode = Page.I8;  headerView.setInt8(24, value as number); break;
                case 'u16': typeCode = Page.U16; headerView.setUint16(24, value as number, littleEndian); break;
                case 'i16': typeCode = Page.I16; headerView.setInt16(24, value as number, littleEndian); break;
                case 'u32': typeCode = Page.U32; headerView.setUint32(24, value as number, littleEndian); break;
                case 'i32': typeCode = Page.I32; headerView.setInt32(24, value as number, littleEndian); break;
                case 'u64': typeCode = Page.U64; headerView.setBigUint64(24, value as bigint, littleEndian); break;
                case 'i64': typeCode = Page.I64; headerView.setBigInt64(24, value as bigint, littleEndian); break;
                default: throw new InputError(`Unknown primitive encoding: ${encoding}`);
            }
        } catch (e) {
            throw new InputError(`Error packing value '${value}' for encoding '${encoding}': ${e instanceof Error ? e.message : e}`);
        }


        headerView.setUint8(1, typeCode); // Set type code

        // Header CRC
        this.setEntryHeaderCrc(entryHeader);

        // Write header to buffer
        this.writeEntryData(entryHeader, 1, nvs);
    }

    getData(): Uint8Array {
        return this.pageBuf;
    }

    // Call when moving to next page to mark this one as full
    finalizePage(): void {
         // Check if current state is ACTIVE before marking FULL
         if (this.dataView.getUint32(0, true) === Page.STATE_ACTIVE) {
             this.dataView.setUint32(0, Page.STATE_FULL, true);
             // Need to recalculate header CRC after changing state
             const crcData = this.pageBuf.slice(4, 28);
             const crcValue = CRC32.buf(crcData, -1);
             const crcUint32 = crcValue >>> 0;
             this.dataView.setUint32(28, crcUint32, true);
         }
    }
}

// --- NVS Class ---
export class NVS {
    private size: number; // Usable size
    private namespaceIndex = 0;
    private pageNum = -1;
    private pages: Page[] = [];
    public currentPage!: Page; // Definite assignment assertion

    constructor(partitionSize: number) {
        // Validate size
        if (partitionSize === 0 || partitionSize % Page.MAX_SIZE !== 0) {
            throw new InputError(`Partition size (${partitionSize}) must be a positive multiple of ${Page.MAX_SIZE}.`);
        }
        // Reserve 1 page minimum
        if (partitionSize < 3 * Page.MAX_SIZE) {
             throw new InputError(`Minimum NVS partition size is ${3 * Page.MAX_SIZE} bytes.`);
        }
        this.size = partitionSize - Page.MAX_SIZE; // Usable size
        console.log(`NVS Initialized. Total Size: ${partitionSize}, Usable Size: ${this.size}`);
        this.createNewPage(); // Create the first page
    }

    createNewPage(isReservedPage = false): Page {
        if (this.currentPage) {
             this.currentPage.finalizePage(); // Mark previous page as full
        }

        if (!isReservedPage) {
            if (this.size < Page.MAX_SIZE) {
                throw new InsufficientSizeError(`Insufficient space for new page. Remaining: ${this.size} bytes.`);
            }
            this.size -= Page.MAX_SIZE;
        }

        this.pageNum++;
        const newPage = new Page(this.pageNum, isReservedPage);
        this.pages.push(newPage);
        this.currentPage = newPage;
        console.log(`Created Page ${this.pageNum}${isReservedPage ? ' (Reserved)' : ''}. Remaining usable size: ${this.size}`);
        return newPage;
    }

    writeNamespace(key: string): void {
        this.namespaceIndex++;
        console.log(`Processing Namespace '${key}' (Index ${this.namespaceIndex})`);
        try {
            // Namespace entries always go in namespace 0
            this.currentPage.writePrimitiveData(key, this.namespaceIndex, 'u8', 0, this);
        } catch (e) {
            if (e instanceof PageFullError) {
                console.log("Page full writing namespace, creating new page...");
                const newPage = this.createNewPage();
                newPage.writePrimitiveData(key, this.namespaceIndex, 'u8', 0, this);
            } else {
                throw e; // Re-throw other errors
            }
        }
    }

    writeEntry(key: string, value: NvsValue, encoding: NvsEncoding): void {
        console.log(`Processing Key '${key}', Encoding '${encoding}', Value type: ${typeof value}`);

        // --- Data Preparation/Validation ---
        let dataToWrite: string | number | bigint | Uint8Array = value; // Start with original value
        let finalEncoding: 'string' | 'binary' | NvsEncoding = encoding; // Final encoding for page write method

        const varlenEncodings = ['string', 'binary', 'hex2bin', 'base64'];
        const primitiveEncodings = ['u8', 'i8', 'u16', 'i16', 'u32', 'i32', 'u64', 'i64'];

        if (varlenEncodings.includes(encoding)) {
             if (encoding === 'hex2bin') {
                 if (typeof value !== 'string') throw new InputError(`Value for hex2bin must be a string.`);
                 const hex = value.replace(/\s/g, ''); // Remove whitespace
                 if (hex.length % 2 !== 0) throw new InputError(`Hex string length must be even.`);
                 if (!/^[0-9a-fA-F]*$/.test(hex)) throw new InputError(`Invalid characters in hex string.`);
                 const bytes = new Uint8Array(hex.length / 2);
                 for (let i = 0; i < hex.length; i += 2) {
                     bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
                 }
                 dataToWrite = bytes;
                 finalEncoding = 'binary';
             } else if (encoding === 'base64') {
                 if (typeof value !== 'string') throw new InputError(`Value for base64 must be a string.`);
                 try {
                     // Convert base64 string to Uint8Array
                     const binaryString = atob(value.trim());
                     const bytes = new Uint8Array(binaryString.length);
                     for (let i = 0; i < binaryString.length; i++) {
                         bytes[i] = binaryString.charCodeAt(i);
                     }
                     dataToWrite = bytes;
                     finalEncoding = 'binary';
                 } catch (e) {
                     throw new InputError(`Invalid base64 string: ${e instanceof Error ? e.message : e}`);
                 }
             } else if (encoding === 'string') {
                 if (typeof value !== 'string') throw new InputError(`Value for string encoding must be a string.`);
                 // dataToWrite remains string, writeVarlenData handles encoding+nullterm
                 finalEncoding = 'string';
             } else { // binary
                  if (!(value instanceof Uint8Array)) throw new InputError(`Value for binary encoding must be a Uint8Array.`);
                  dataToWrite = value;
                  finalEncoding = 'binary';
             }
        } else if (primitiveEncodings.includes(encoding)) {
            try {
                let numValue: number | bigint;
                 if (typeof value === 'string') {
                      const strValue = value.trim();
                      if (encoding === 'u64' || encoding === 'i64') {
                          // BigInt supports '0x' prefix etc.
                          numValue = BigInt(strValue);
                      } else {
                          // parseInt supports '0x', '0o', '0b' prefixes if radix is 0 or undefined
                          numValue = parseInt(strValue, 0);
                          if (isNaN(numValue)) throw new Error(); // Trigger catch
                      }
                 } else if (typeof value === 'number') {
                     if (encoding === 'u64' || encoding === 'i64') {
                          numValue = BigInt(value); // Convert number to BigInt if needed
                     } else {
                          numValue = value;
                     }
                 } else {
                      throw new InputError(`Invalid value type '${typeof value}' for primitive encoding '${encoding}'. Expected string or number.`);
                 }
                dataToWrite = numValue;
                finalEncoding = encoding;
            } catch (e) {
                throw new InputError(`Invalid value "${value}" for primitive type "${encoding}": ${e instanceof Error ? e.message : e}`);
            }
        } else {
             throw new InputError(`Unsupported encoding: ${encoding}`);
        }

        // --- Write using Page methods ---
        try {
             if (finalEncoding === 'string' || finalEncoding === 'binary') {
                  this.currentPage.writeVarlenData(key, dataToWrite as (string | Uint8Array), finalEncoding, this.namespaceIndex, this);
             } else if (primitiveEncodings.includes(finalEncoding)){
                  this.currentPage.writePrimitiveData(key, dataToWrite as (number | bigint), finalEncoding, this.namespaceIndex, this);
             } else {
                   throw new InputError(`Internal error: Unhandled finalEncoding ${finalEncoding}`);
             }
        } catch (e) {
             if (e instanceof PageFullError) {
                  console.log(`Page full writing entry '${key}', creating new page...`);
                  const newPage = this.createNewPage();
                  // Retry on the new page
                  if (finalEncoding === 'string' || finalEncoding === 'binary') {
                       newPage.writeVarlenData(key, dataToWrite as (string | Uint8Array), finalEncoding, this.namespaceIndex, this);
                  } else if (primitiveEncodings.includes(finalEncoding)){
                       newPage.writePrimitiveData(key, dataToWrite as (number | bigint), finalEncoding, this.namespaceIndex, this);
                  }
             } else {
                  throw e; // Re-throw other errors
             }
        }
    }

    // Finalize NVS generation and return the full binary data
    getBinaryData(): Uint8Array {
        // Ensure remaining space is filled and last page added
        while (this.size >= Page.MAX_SIZE) {
            this.createNewPage();
        }
        // Add the final reserved page if not already the last one added
        if (!this.pages[this.pages.length - 1]?.getData().every(byte => byte === 0xFF)) {
             this.createNewPage(true); // Add reserved page marker
        } else {
             this.currentPage.finalizePage(); // Finalize the last real page if it wasn't full
        }


        // Concatenate all page buffers
        const totalSize = this.pages.length * Page.MAX_SIZE;
        const result = new Uint8Array(totalSize);
        let offset = 0;
        for (const page of this.pages) {
            result.set(page.getData(), offset);
            offset += Page.MAX_SIZE;
        }
        console.log(`Final binary size: ${result.length} bytes`);
        return result;
    }
}

// --- Helper: Parse CSV and Generate Binary Blob ---

export async function generateNvsBlobFromCsv(
    csvContent: string,
    partitionSizeString: string
): Promise<Blob> {
    console.log("Starting NVS generation from CSV content...");

    // 1. Validate Partition Size
    let partitionSize: number;
    try {
        partitionSize = parseInt(partitionSizeString, 0); // Allow hex etc.
        if (isNaN(partitionSize) || partitionSize <= 0 || partitionSize % Page.MAX_SIZE !== 0) {
            throw new Error(); // Trigger catch
        }
         if (partitionSize < 3 * Page.MAX_SIZE) {
             throw new InputError(`Minimum NVS partition size is ${3 * Page.MAX_SIZE} bytes.`);
         }
    } catch {
        throw new InputError(`Invalid partition size "${partitionSizeString}". Must be a positive multiple of ${Page.MAX_SIZE}.`);
    }
    console.log(`Requested Partition Size: ${partitionSize} bytes`);

    // 2. Parse CSV
    // PapaParse options: skip empty lines, use first row as header
    const parseResult = Papa.parse<NvsCsvRow>(csvContent, {
        header: true,
        skipEmptyLines: true,
        transformHeader: header => header.trim().toLowerCase(), // Normalize headers
         // Filter comments and rows without key/type/encoding (unless namespace)
        beforeFirstChunk: (chunk) => {
            // Filter out comment lines (# at the start)
            const lines = chunk.split('\n');
            const filteredLines = lines.filter(line => !line.trim().startsWith('#'));
            return filteredLines.join('\n');
        },
    });


    if (parseResult.errors.length > 0) {
        console.error("CSV Parsing Errors:", parseResult.errors);
        // Provide a more user-friendly error message
        const firstError = parseResult.errors[0];
        throw new InputError(`CSV parsing error near line ${firstError.row}: ${firstError.message} (Code: ${firstError.code})`);
    }

    const rows = parseResult.data;
    console.log(`Parsed ${rows.length} data rows from CSV.`);

    // 3. Initialize NVS Generator
    const nvs = new NVS(partitionSize);

    // 4. Process Rows
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const lineNum = parseResult.meta.cursor ? parseResult.meta.cursor + i + 1 : i+2; // Approximate line number

        try {
            // Trim and validate row data
            const key = row.key?.trim();
            const type = row.type?.trim().toLowerCase() as NvsEntryType | undefined;
            const encoding = row.encoding?.trim().toLowerCase() as NvsEncoding | undefined;
            const value = row.value; // Keep original value string, NVS class handles parsing/conversion

            if (!key) throw new Error("Missing 'key'");
            if (!type) throw new Error("Missing 'type'");
            if (type !== 'namespace' && !encoding) throw new Error("Missing 'encoding'");
            if (type !== 'namespace' && value === undefined) throw new Error("Missing 'value'"); // Check for undefined specifically


            if (key.length > 15) {
                throw new Error(`Key '${key}' exceeds maximum length of 15 characters.`);
            }
            const textEncoder = new TextEncoder();
            if (textEncoder.encode(key).length > 15) {
                 throw new Error(`Key '${key}' exceeds maximum UTF-8 length of 15 bytes.`);
            }

            if (type === 'namespace') {
                nvs.writeNamespace(key);
            } else if (type === 'data') {
                 if (!encoding) throw new Error("Encoding required for type 'data'"); // Should be caught above, but safety
                nvs.writeEntry(key, value, encoding);
            } else if (type === 'file') {
                // In a web context, 'file' type needs special handling.
                // We can't directly read local file paths for security reasons.
                // Option 1: Disallow 'file' type in web UI.
                // Option 2: Require user to upload the file separately and pass its content (as Uint8Array).
                throw new InputError(`Type 'file' is not directly supported in the web generator. Please use type 'data' with base64 or hex2bin encoding, or upload the file content separately.`);

            } else {
                throw new Error(`Invalid type '${type}'. Must be 'namespace' or 'data'.`);
            }

        } catch (error) {
            let errMsg = `Error processing CSV row ${i + 1} (approx line ${lineNum}):\nRow: ${JSON.stringify(row)}\nError: ${error instanceof Error ? error.message : String(error)}`;
            if (error instanceof InputError || error instanceof InsufficientSizeError || error instanceof PageFullError) {
                 // Keep specific error type messages
                 errMsg = `Error processing CSV row ${i + 1} (approx line ${lineNum}): ${error.message}\nRow: ${JSON.stringify(row)}`;
            }
             console.error(errMsg);
            // Re-throw as InputError for consistent handling in UI
            throw new InputError(errMsg);
        }
    }

    // 5. Finalize and Get Binary Data
    const binaryData = nvs.getBinaryData();

    // 6. Create Blob
    const blob = new Blob([binaryData], { type: 'application/octet-stream' });
    console.log("NVS Blob generated successfully.");
    return blob;
}