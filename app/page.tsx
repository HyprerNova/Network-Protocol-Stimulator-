'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ArrowRight, CheckCircle, XCircle, Clock, RotateCcw, Zap, Send } from 'lucide-react'
import { useIsMobile } from '@/hooks/use-mobile'

type Protocol = 'simple' | 'stop-and-wait' | 'go-back-n' | 'selective-repeat'
interface Packet {
  id: number
  sequenceNumber: number
  data: string
  status: 'sending' | 'sent' | 'acknowledged' | 'lost' | 'retransmitting' | 'received' | 'buffered' | 'discarded'
  timestamp: number
  isRetransmission?: boolean
}
interface AckPacket {
  id: number
  sequenceNumber: number
  status: 'sending' | 'received'
  timestamp: number
  type: 'ACK' | 'NACK'
}

export default function NetworkProtocolSimulator() {
  const isMobile = useIsMobile()
  const [protocol, setProtocol] = useState<Protocol>('stop-and-wait')
  const [packets, setPackets] = useState<Packet[]>([])
  const [acks, setAcks] = useState<AckPacket[]>([])
  const [isSimulating, setIsSimulating] = useState(false)
  const [windowSize, setWindowSize] = useState(4)
  const [nextSequenceNumber, setNextSequenceNumber] = useState(0)
  const [expectedSequenceNumber, setExpectedSequenceNumber] = useState(0)
  const [senderWindow, setSenderWindow] = useState<number[]>([])
  const [receiverBuffer, setReceiverBuffer] = useState<Packet[]>([])
  const [waitingForAck, setWaitingForAck] = useState(false)
  const [showDiagram, setShowDiagram] = useState(false)

  const protocolDescriptions = {
    simple: 'Basic packet transmission without acknowledgments or error handling.',
    'stop-and-wait': 'Send one frame, wait for ACK, then send next frame. Only one frame in transit at a time.',
    'go-back-n': 'Send multiple frames in window. If error occurs, retransmit from error point. Frames must be received in sequence.',
    'selective-repeat': 'Send multiple frames in window. Selectively retransmit only missing frames. Receiver buffers out-of-order frames.'
  }

  const resetSimulation = () => {
    setPackets([])
    setAcks([])
    setNextSequenceNumber(0)
    setExpectedSequenceNumber(0)
    setSenderWindow([])
    setReceiverBuffer([])
    setWaitingForAck(false)
    setIsSimulating(false)
    setShowDiagram(false)
  }

  const canSendPacket = () => {
    if (isSimulating) return false
    switch (protocol) {
      case 'simple': return true
      case 'stop-and-wait': return !waitingForAck
      case 'go-back-n':
      case 'selective-repeat': 
        if (senderWindow.length >= windowSize) return false
        
        if (senderWindow.length === 0) {
          return true
        }
        
        const base = Math.min(...senderWindow) // Lowest unacked sequence number
        const windowEnd = base + windowSize - 1
        
        // Can only send if nextSequenceNumber is within the window and base hasn't advanced past unacked frames
        return nextSequenceNumber >= base && nextSequenceNumber <= windowEnd
      default: return true
    }
  }

  const sendPacket = async () => {
    if (!canSendPacket()) return
    setIsSimulating(true)
    const newPacket: Packet = {
      id: Date.now(),
      sequenceNumber: nextSequenceNumber,
      data: `Frame ${nextSequenceNumber}`,
      status: 'sending',
      timestamp: Date.now()
    }
    setPackets(prev => [...prev, newPacket])
    if (protocol === 'go-back-n' || protocol === 'selective-repeat') {
      setSenderWindow(prev => [...prev, nextSequenceNumber])
    }
    if (protocol === 'stop-and-wait') {
      setWaitingForAck(true)
    }
    setTimeout(() => {
      setPackets(prev => prev.map(p =>
        p.id === newPacket.id ? { ...p, status: 'received' } : p
      ))
      setIsSimulating(false)
    }, 1000)
    setNextSequenceNumber(prev => prev + 1)
  }

  const retransmitPacket = (sequenceNumber: number) => {
    const originalPacket = packets.find(p => p.sequenceNumber === sequenceNumber)
    if (!originalPacket) return
    const retransmittedPacket: Packet = {
      id: Date.now(),
      sequenceNumber: sequenceNumber,
      data: originalPacket.data,
      status: 'retransmitting',
      timestamp: Date.now(),
      isRetransmission: true
    }
    setPackets(prev => [...prev, retransmittedPacket])
    setTimeout(() => {
      setPackets(prev => prev.map(p =>
        p.id === retransmittedPacket.id ? { ...p, status: 'received' } : p
      ))
      if (protocol === 'stop-and-wait') {
        setWaitingForAck(false)
      }
    }, 1000)
  }

  const retransmitFromSequence = (fromSequence: number) => {
    const packetsToRetransmit = senderWindow.filter(seq => seq >= fromSequence)
    packetsToRetransmit.forEach((seq, index) => {
      setTimeout(() => {
        retransmitPacket(seq)
      }, index * 500)
    })
  }

  const losePacket = (packetId: number) => {
    setPackets(prev => prev.map(p =>
      p.id === packetId ? { ...p, status: 'lost' } : p
    ))
    const packet = packets.find(p => p.id === packetId)
    if (!packet) return
    if (protocol === 'stop-and-wait') {
      setTimeout(() => {
        retransmitPacket(packet.sequenceNumber)
      }, 500)
    } else if (protocol === 'go-back-n') {
      setTimeout(() => retransmitFromSequence(Math.min(...senderWindow)), 500) // Retransmit from base (e.g., 0 to 2)
    } else if (protocol === 'selective-repeat') {
      setTimeout(() => retransmitPacket(packet.sequenceNumber), 500)
    }
  }

  const sendAck = (sequenceNumber: number) => {
    const packet = packets.find(p => p.sequenceNumber === sequenceNumber && p.status === 'received')
    if (!packet) return
    let shouldSendAck = false
    let ackType: 'ACK' | 'NACK' = 'ACK'
    switch (protocol) {
      case 'simple':
        shouldSendAck = true
        break
      case 'stop-and-wait':
        if (sequenceNumber === expectedSequenceNumber) {
          shouldSendAck = true
          setExpectedSequenceNumber(prev => prev + 1)
        } else {
          ackType = 'NACK'
          shouldSendAck = true
        }
        break
      case 'go-back-n':
        shouldSendAck = true // Allow ACK for any received frame
        if (sequenceNumber >= expectedSequenceNumber) {
          // Only advance expectedSequenceNumber if it's the next in order
          if (sequenceNumber === expectedSequenceNumber) {
            setExpectedSequenceNumber(prev => prev + 1)
            // Slide senderWindow for all contiguous ACKs up to this point
            setSenderWindow(prev => prev.filter(seq => seq > expectedSequenceNumber - 1))
          } else {
            // For out-of-order ACK (e.g., 1 or 2), remove it from senderWindow but don't advance base
            setSenderWindow(prev => prev.filter(seq => seq !== sequenceNumber))
          }
        }
        break
      case 'selective-repeat':
        shouldSendAck = true
        if (sequenceNumber !== expectedSequenceNumber) {
          setReceiverBuffer(prev => [...prev, packet])
          setPackets(prev => prev.map(p =>
            p.sequenceNumber === sequenceNumber ? { ...p, status: 'buffered' } : p
          ))
        } else {
          setExpectedSequenceNumber(prev => prev + 1)
          let nextExpected = expectedSequenceNumber + 1
          const newBuffer = receiverBuffer.filter(p => {
            if (p.sequenceNumber === nextExpected) {
              nextExpected++
              return false
            }
            return true
          })
          setReceiverBuffer(newBuffer)
          setExpectedSequenceNumber(nextExpected)
        }
        break
    }
    if (shouldSendAck) {
      const newAck: AckPacket = {
        id: Date.now(),
        sequenceNumber,
        status: 'sending',
        timestamp: Date.now(),
        type: ackType
      }
      if (protocol !== 'stop-and-wait') {
        setAcks(prev => [...prev, newAck])
      }
      setTimeout(() => {
        if (protocol !== 'stop-and-wait') {
          setAcks(prev => prev.map(a =>
            a.id === newAck.id ? { ...a, status: 'received' } : a
          ))
        }
        if (ackType === 'ACK') {
          setPackets(prev => prev.map(p =>
            p.sequenceNumber === sequenceNumber ? { ...p, status: 'acknowledged' } : p
          ))
          if (protocol === 'go-back-n') {
            // Slide window only for the acknowledged frame
            setSenderWindow(prev => prev.filter(seq => seq !== sequenceNumber))
          } else if (protocol === 'selective-repeat') {
            setSenderWindow(prev => prev.filter(seq => seq !== sequenceNumber))
          }
          if (protocol === 'stop-and-wait') {
            setWaitingForAck(false)
          }
        }
      }, 500)
    }
  }

  const sendNack = (sequenceNumber: number) => {
    const newAck: AckPacket = {
      id: Date.now(),
      sequenceNumber,
      status: 'sending',
      timestamp: Date.now(),
      type: 'NACK'
    }
    if (protocol !== 'stop-and-wait') {
      setAcks(prev => [...prev, newAck])
    }
    setTimeout(() => {
      if (protocol !== 'stop-and-wait') {
        setAcks(prev => prev.map(a =>
          a.id === newAck.id ? { ...a, status: 'received' } : a
        ))
      }
      setPackets(prev => prev.map(p =>
        p.sequenceNumber === sequenceNumber ? { ...p, status: 'lost' } : p
      ))
      if (protocol === 'stop-and-wait') {
        retransmitPacket(sequenceNumber)
      } else if (protocol === 'go-back-n') {
        setTimeout(() => retransmitFromSequence(Math.min(...senderWindow)), 500) // Retransmit from base (e.g., 0 to 2)
      } else if (protocol === 'selective-repeat') {
        retransmitPacket(sequenceNumber)
      }
    }, 500)
  }

  const getStatusIcon = (status: Packet['status']) => {
    switch (status) {
      case 'sending':
      case 'retransmitting':
        return <Clock className="w-4 h-4 text-blue-500" />
      case 'sent':
      case 'received':
        return <ArrowRight className="w-4 h-4 text-yellow-500" />
      case 'acknowledged':
        return <CheckCircle className="w-4 h-4 text-green-500" />
      case 'lost':
        return <XCircle className="w-4 h-4 text-red-500" />
      case 'buffered':
        return <Clock className="w-4 h-4 text-purple-500" />
      case 'discarded':
        return <XCircle className="w-4 h-4 text-gray-500" />
      default:
        return null
    }
  }

  const getStatusColor = (status: Packet['status']) => {
    switch (status) {
      case 'sending':
      case 'retransmitting':
        return 'bg-blue-100 text-blue-800'
      case 'sent':
      case 'received':
        return 'bg-yellow-100 text-yellow-800'
      case 'acknowledged':
        return 'bg-green-100 text-green-800'
      case 'lost':
        return 'bg-red-100 text-red-800'
      case 'buffered':
        return 'bg-purple-100 text-purple-800'
      case 'discarded':
        return 'bg-gray-100 text-gray-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const getReceivedPackets = () => {
    return packets.filter(p => ['received', 'acknowledged', 'buffered', 'discarded'].includes(p.status))
  }

  const generateSequenceDiagram = () => {
    const width = 800
    const height = 400
    const lifelineX = { sender: 100, receiver: 600 }
    const allTimestamps = [...packets.map(p => p.timestamp), ...acks.map(a => a.timestamp)].sort((a, b) => a - b)
    const minTime = allTimestamps[0] || Date.now()
    const maxTime = allTimestamps[allTimestamps.length - 1] || Date.now()
    const timeRange = maxTime - minTime
    const timeUnit = timeRange ? (height - 40) / timeRange : 1

    let svgContent = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <line x1="${lifelineX.sender}" y1="20" x2="${lifelineX.sender}" y2="${height - 20}" stroke="black" />
        <text x="${lifelineX.sender - 30}" y="10" text-anchor="end">Sender</text>
        <line x1="${lifelineX.receiver}" y1="20" x2="${lifelineX.receiver}" y2="${height - 20}" stroke="black" />
        <text x="${lifelineX.receiver + 30}" y="10" text-anchor="start">Receiver</text>
    `

    // Sort and render packets (sent events)
    packets
      .filter(p => p.status === 'received')
      .sort((a, b) => a.timestamp - b.timestamp)
      .forEach(p => {
        const y = 20 + ((p.timestamp - minTime) * timeUnit)
        svgContent += `<line x1="${lifelineX.sender}" y1="${y}" x2="${lifelineX.receiver}" y2="${y}" stroke="black" marker-end="url(#arrow)" />
          <text x="${(lifelineX.sender + lifelineX.receiver) / 2}" y="${y - 5}" text-anchor="middle">Send ${p.sequenceNumber}</text>`
      })

    // Sort and render acks
    acks
      .sort((a, b) => a.timestamp - b.timestamp)
      .forEach(a => {
        const y = 20 + ((a.timestamp - minTime) * timeUnit)
        if (a.type === 'ACK') {
          svgContent += `<line x1="${lifelineX.receiver}" y1="${y}" x2="${lifelineX.sender}" y2="${y}" stroke="green" marker-end="url(#arrow)" />
            <text x="${(lifelineX.sender + lifelineX.receiver) / 2}" y="${y - 5}" text-anchor="middle">ACK ${a.sequenceNumber}</text>`
        } else if (a.type === 'NACK') {
          svgContent += `<line x1="${lifelineX.receiver}" y1="${y}" x2="${lifelineX.sender}" y2="${y}" stroke="red" marker-end="url(#arrow)" />
            <text x="${(lifelineX.sender + lifelineX.receiver) / 2}" y="${y - 5}" text-anchor="middle">NACK ${a.sequenceNumber}</text>`
        }
      })

    svgContent += `
      <defs>
        <marker id="arrow" markerWidth="10" markerHeight="10" refX="0" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L0,6 L9,3 z" fill="black" />
        </marker>
      </defs>
      </svg>
    `
    return svgContent
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 sm:p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="text-center space-y-2">
          <div className="flex justify-between items-center">
            <h1 className={`font-bold text-slate-900 ${isMobile ? 'text-2xl' : 'text-4xl'}`}>
              Network Protocol Simulator
            </h1>
            <Button onClick={() => setShowDiagram(true)} className={` ${isMobile ? 'text-sm py-1' : ''}`}>
              Finish
            </Button>
          </div>
          <p className={`text-slate-600 ${isMobile ? 'text-sm' : 'text-base'}`}>
            Learn how different ARQ protocols handle packet transmission and acknowledgments
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className={isMobile ? 'text-lg' : 'text-xl'}>Simulation Controls</CardTitle>
            <CardDescription className={isMobile ? 'text-sm' : 'text-base'}>
              Configure your network protocol simulation
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className={`grid gap-4 ${isMobile ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-4'}`}>
              <div className="space-y-2">
                <Label htmlFor="protocol" className={isMobile ? 'text-sm' : ''}>Protocol</Label>
                <Select value={protocol} onValueChange={(value: Protocol) => {
                  setProtocol(value)
                  resetSimulation()
                }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select protocol" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="simple">Simple</SelectItem>
                    <SelectItem value="stop-and-wait">Stop-and-Wait ARQ</SelectItem>
                    <SelectItem value="go-back-n">Go-Back-N ARQ</SelectItem>
                    <SelectItem value="selective-repeat">Selective Repeat ARQ</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="windowSize" className={isMobile ? 'text-sm' : ''}>Window Size</Label>
                {(protocol === 'go-back-n' || protocol === 'selective-repeat') ? (
                  <Select value={windowSize.toString()} onValueChange={(value) => {
                    setWindowSize(parseInt(value))
                    resetSimulation()
                  }}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select window size" />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 8 }, (_, i) => i + 1).map(num => (
                        <SelectItem key={num} value={num.toString()}>{num}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className={`text-sm text-slate-600 bg-slate-50 p-2 rounded border ${isMobile ? 'text-xs' : ''}`}>
                    {protocol === 'stop-and-wait' ? '1 (Stop-and-Wait)' : 'N/A (Simple)'}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label className={isMobile ? 'text-sm' : ''}>Sender Actions</Label>
                <div className="flex space-x-2">
                  <Button
                    onClick={sendPacket}
                    disabled={!canSendPacket()}
                    className={`flex-1 ${isMobile ? 'text-sm py-1' : ''}`}
                  >
                    <Send className="w-4 h-4 mr-2" />
                    Send Frame
                  </Button>
                </div>
                {protocol === 'stop-and-wait' && waitingForAck && (
                  <div className={`text-xs text-orange-600 ${isMobile ? 'text-[10px]' : ''}`}>Waiting for ACK...</div>
                )}
              </div>
              <div className="space-y-2">
                <Label className={isMobile ? 'text-sm' : ''}>Reset</Label>
                <Button
                  onClick={resetSimulation}
                  variant="outline"
                  className={`w-full ${isMobile ? 'text-sm py-1' : ''}`}
                >
                  Reset
                </Button>
              </div>
            </div>
            <div className="p-4 bg-slate-50 rounded-lg">
              <h3 className={`font-semibold text-slate-900 mb-2 ${isMobile ? 'text-sm' : ''}`}>
                {protocol.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}
              </h3>
              <p className={`text-sm text-slate-600 ${isMobile ? 'text-xs' : ''}`}>{protocolDescriptions[protocol]}</p>
              {(protocol === 'go-back-n' || protocol === 'selective-repeat') && (
                <div className={`mt-2 text-xs text-slate-500 ${isMobile ? 'text-[10px]' : ''}`}>
                  Current window: [{senderWindow.join(', ')}] | Expected seq: {expectedSequenceNumber} | Window size: {windowSize}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        <div className={`grid gap-6 ${isMobile ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2'}`}>
          <Card>
            <CardHeader>
              <CardTitle className={`flex items-center space-x-2 ${isMobile ? 'text-lg' : 'text-xl'}`}>
                <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                <span>Sender</span>
              </CardTitle>
              <CardDescription className={isMobile ? 'text-sm' : ''}>Outgoing frames and retransmissions</CardDescription>
            </CardHeader>
            <CardContent>
              <div className={`space-y-3 ${isMobile ? 'max-h-80' : 'max-h-96'} overflow-y-auto`}>
                {packets.length === 0 ? (
                  <div className={`text-center py-8 text-slate-500 ${isMobile ? 'text-sm' : ''}`}>
                    No frames sent yet. Click "Send Frame" to start.
                  </div>
                ) : (
                  packets.map((packet) => (
                    <div key={packet.id} className={`flex items-center space-x-3 p-3 bg-white rounded-lg border ${isMobile ? 'flex-col items-start space-y-2' : ''}`}>
                      <div className="flex items-center space-x-2">
                        {getStatusIcon(packet.status)}
                        <span className={`font-mono ${isMobile ? 'text-xs' : 'text-sm'}`}>
                          Seq: {packet.sequenceNumber}
                          {packet.isRetransmission && <span className="text-orange-500 ml-1">(R)</span>}
                        </span>
                      </div>
                      <div className="flex-1">
                        <div className={`font-medium ${isMobile ? 'text-xs' : 'text-sm'}`}>{packet.data}</div>
                        <Badge variant="secondary" className={getStatusColor(packet.status)}>
                          {packet.status.replace('-', ' ')}
                        </Badge>
                      </div>
                      <div className={`flex items-center space-x-2 ${isMobile ? 'w-full justify-between' : ''}`}>
                        {packet.status === 'received' && (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => losePacket(packet.id)}
                            className={isMobile ? 'text-xs px-2 py-1' : ''}
                          >
                            <Zap className="w-3 h-3 mr-1" />
                            Lose
                          </Button>
                        )}
                        <div className={`text-xs text-slate-500 ${isMobile ? 'text-[10px]' : ''}`}>
                          {new Date(packet.timestamp).toLocaleTimeString()}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className={`flex items-center space-x-2 ${isMobile ? 'text-lg' : 'text-xl'}`}>
                <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                <span>Receiver</span>
              </CardTitle>
              <CardDescription className={isMobile ? 'text-sm' : ''}>Received frames and acknowledgments</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <h4 className={`text-sm font-semibold text-slate-700 mb-2 ${isMobile ? 'text-xs' : ''}`}>
                    Received Frames (Expected: {expectedSequenceNumber})
                  </h4>
                  <div className={`space-y-2 ${isMobile ? 'max-h-80' : 'max-h-96'} overflow-y-auto`}>
                    {getReceivedPackets().length === 0 ? (
                      <div className={`text-center py-4 text-slate-500 text-sm ${isMobile ? 'text-xs' : ''}`}>
                        No frames received yet.
                      </div>
                    ) : (
                      getReceivedPackets().map((packet) => (
                        <div key={packet.id} className={`flex items-center space-x-3 p-2 bg-white rounded-lg border ${isMobile ? 'flex-col items-start space-y-2' : ''}`}>
                          <div className="flex items-center space-x-2">
                            {getStatusIcon(packet.status)}
                            <span className="font-mono text-xs">Seq: {packet.sequenceNumber}</span>
                          </div>
                          <div className="flex-1">
                            <div className={`font-medium ${isMobile ? 'text-xs' : 'text-sm'}`}>{packet.data}</div>
                            <Badge variant="secondary" className={getStatusColor(packet.status)}>
                              {packet.status}
                            </Badge>
                          </div>
                          <div className={`flex items-center space-x-1 ${isMobile ? 'w-full justify-between' : ''}`}>
                            {packet.status === 'received' && (
                              <>
                                <Button
                                  size="sm"
                                  onClick={() => sendAck(packet.sequenceNumber)}
                                  className="text-xs px-2 py-1"
                                >
                                  ACK
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => sendNack(packet.sequenceNumber)}
                                  className="text-xs px-2 py-1"
                                >
                                  NACK
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
                {protocol !== 'stop-and-wait' && (
                  <>
                    <Separator />
                    <div>
                      <h4 className={`text-sm font-semibold text-slate-700 mb-2 ${isMobile ? 'text-xs' : ''}`}>
                        ACK/NACK History
                      </h4>
                      <div className={`space-y-2 ${isMobile ? 'max-h-80' : 'max-h-96'} overflow-y-auto`}>
                        {acks.length === 0 ? (
                          <div className={`text-center py-4 text-slate-500 text-sm ${isMobile ? 'text-xs' : ''}`}>
                            No acknowledgments sent yet.
                          </div>
                        ) : (
                          acks.map((ack) => (
                            <div key={ack.id} className={`flex items-center space-x-3 p-2 bg-white rounded-lg border ${isMobile ? 'flex-col items-start space-y-2' : ''}`}>
                              <div className="flex items-center space-x-2">
                                {ack.type === 'ACK' ?
                                  <CheckCircle className="w-3 h-3 text-green-500" /> :
                                  <XCircle className="w-3 h-3 text-red-500" />
                                }
                                <span className="font-mono text-xs">{ack.type}: {ack.sequenceNumber}</span>
                              </div>
                              <div className="flex-1">
                                <Badge variant="secondary" className={
                                  ack.type === 'ACK' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                }>
                                  {ack.status}
                                </Badge>
                              </div>
                              <div className={`text-xs text-slate-500 ${isMobile ? 'text-[10px]' : ''}`}>
                                {new Date(ack.timestamp).toLocaleTimeString()}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </>
                )}
                {protocol === 'selective-repeat' && receiverBuffer.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <h4 className={`text-sm font-semibold text-slate-700 mb-2 ${isMobile ? 'text-xs' : ''}`}>
                        Receiver Buffer
                      </h4>
                      <div className={`text-xs text-slate-600 ${isMobile ? 'text-[10px]' : ''}`}>
                        Buffered frames: [{receiverBuffer.map(p => p.sequenceNumber).sort((a, b) => a - b).join(', ')}]
                      </div>
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className={isMobile ? 'text-lg' : 'text-xl'}>Transmission Statistics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`grid gap-4 ${isMobile ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-6'}`}>
              <div className="text-center">
                <div className={`font-bold text-blue-600 ${isMobile ? 'text-lg' : 'text-2xl'}`}>{packets.length}</div>
                <div className={`text-sm text-slate-600 ${isMobile ? 'text-xs' : ''}`}>Total Sent</div>
              </div>
              <div className="text-center">
                <div className={`font-bold text-green-600 ${isMobile ? 'text-lg' : 'text-2xl'}`}>
                  {packets.filter(p => p.status === 'acknowledged').length}
                </div>
                <div className={`text-sm text-slate-600 ${isMobile ? 'text-xs' : ''}`}>Acknowledged</div>
              </div>
              <div className="text-center">
                <div className={`font-bold text-red-600 ${isMobile ? 'text-lg' : 'text-2xl'}`}>
                  {packets.filter(p => p.status === 'lost').length}
                </div>
                <div className={`text-sm text-slate-600 ${isMobile ? 'text-xs' : ''}`}>Lost</div>
              </div>
              <div className="text-center">
                <div className={`font-bold text-orange-600 ${isMobile ? 'text-lg' : 'text-2xl'}`}>
                  {packets.filter(p => p.isRetransmission).length}
                </div>
                <div className={`text-sm text-slate-600 ${isMobile ? 'text-xs' : ''}`}>Retransmitted</div>
              </div>
              <div className="text-center">
                <div className={`font-bold text-purple-600 ${isMobile ? 'text-lg' : 'text-2xl'}`}>
                  {receiverBuffer.length}
                </div>
                <div className={`text-sm text-slate-600 ${isMobile ? 'text-xs' : ''}`}>Buffered</div>
              </div>
              <div className="text-center">
                <div className={`font-bold text-slate-600 ${isMobile ? 'text-lg' : 'text-2xl'}`}>
                  {packets.length > 0 ? Math.round((packets.filter(p => p.status === 'acknowledged').length / packets.filter(p => !p.isRetransmission).length) * 100) : 0}%
                </div>
                <div className={`text-sm text-slate-600 ${isMobile ? 'text-xs' : ''}`}>Success Rate</div>
              </div>
            </div>
          </CardContent>
        </Card>
        {showDiagram && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white p-4 rounded-lg max-h-[80vh] overflow-auto">
              <h2 className="text-xl font-bold mb-4">Sequence Diagram</h2>
              <div dangerouslySetInnerHTML={{ __html: generateSequenceDiagram() }} />
              <Button onClick={() => setShowDiagram(false)} className="mt-4">Close</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}