'use strict';

// OMG UML 2.5.1, Annex A. Interaction diagrams are a subset of behavior diagrams.
function template(id,zh,en,group,descriptionZh,descriptionEn,body) {
  return Object.freeze({id,zh,en,group,descriptionZh,descriptionEn,source:'@startuml\n'+body+'\n@enduml\n'});
}

const uml_templates=Object.freeze([
  template('class','类图','Class diagram','structure',
    '查看采样器持有的数据类型及其操作。',
    'Show the data a sampler owns and the operations it exposes.',
`class Sample {
  value : int
}
class Sampler {
  +read() : Sample
}
Sampler *-- Sample : latest`),
  template('object','对象图','Object diagram','structure',
    '记录一个时刻的对象、字段值和对象之间的连接。',
    'Capture object instances, field values and links at one point in time.',
`object "sensor0 : Sensor" as sensor {
  channel = 0
}
object "latest : Sample" as sample {
  value = 23
}
sensor -- sample : latest`),
  template('component','组件图','Component diagram','structure',
    '标出应用、采样模块和设备驱动之间的接口依赖。',
    'Trace interface dependencies between the application, its sampling service and the driver.',
`component Application as app
component "Sampling service" as sampler
interface "Sensor API" as api
component "Sensor driver" as driver
app --> sampler
sampler ..> api : uses
api - driver`),
  template('composite-structure','组合结构图','Composite structure diagram','structure',
    '用 PlantUML 的容器、端口和连接线表示采样管线内部的协作部件。',
    'Use PlantUML containers, ports and connectors to sketch collaborating parts inside a sampling pipeline.',
`left to right direction
skinparam linetype ortho
interface "Sample trigger" as input
interface "Sample stream" as output
component "Sampling pipeline" {
  portin " " as trigger
  component "reader : Sampler" as reader
  component "queue : MessageQueue" as queue
  portout " " as samples
  trigger -- reader
  reader -- queue
  queue -- samples
}
input -- trigger
samples -- output`),
  template('deployment','部署图','Deployment diagram','structure',
    '将固件镜像、开发板和主机工具对应到部署位置。',
    'Map firmware and host tools to the nodes where they run.',
`node "Development host" as host {
  artifact "west" as west
}
node "Target board" as board {
  artifact "zephyr.elf" as firmware
}
host -- board : debug probe`),
  template('package','包图','Package diagram','structure',
    '划分应用、驱动和内核包，查看包之间的依赖方向。',
    'Group application, driver and kernel types and inspect package dependencies.',
`package "Application" as app {
  class Sampler
}
package "Drivers" as drivers {
  interface Sensor
}
package "Kernel" as kernel {
  class MessageQueue
}
app ..> drivers
app ..> kernel`),
  template('profile','剖面图','Profile diagram','structure',
    '用 PlantUML 的包、构造型和带标签的连接表示领域扩展，例如线程优先级。',
    'Sketch domain extensions such as thread priority using a PlantUML package, stereotypes and a labeled extension link.',
`package "RTOS" <<profile>> {
  class Thread <<stereotype>> {
    priority : Integer
  }
}
class "UML::Class" as Classifier <<metaclass>>
Thread --> Classifier : <<extension>>`),
  template('use-case','用例图','Use case diagram','behavior',
    '从操作者的视角明确设备支持的操作。',
    'Describe the operations the device provides to its operator.',
`left to right direction
actor Operator
rectangle "Sensor node" {
  usecase "Start sampling" as start
  usecase "Read latest sample" as read
}
Operator --> start
Operator --> read`),
  template('activity','活动图','Activity diagram','behavior',
    '沿控制流检查采样、条件判断和队列写入。',
    'Follow control flow from a sensor read through validation to a queue write.',
`start
:Read sensor;
if (Sample valid?) then (yes)
  :Enqueue sample;
else (no)
  :Record error;
endif
stop`),
  template('state-machine','状态机图','State machine diagram','behavior',
    '描述采样设备在事件触发时如何切换状态。',
    'Track how events move a sampling device between states.',
`[*] --> Idle
Idle --> Sampling : start
Sampling --> Idle : stop
Sampling --> Fault : read error
Fault --> Idle : reset`),
  template('sequence','顺序图','Sequence diagram','interaction',
    '按发生顺序查看线程、驱动和消息队列之间的调用与返回。',
    'Follow calls and replies between a thread, a driver and a message queue in time order.',
`participant "Sampler thread" as worker
participant "Sensor driver" as driver
participant "Message queue" as queue
worker -> driver : sensor_sample_fetch()
driver --> worker : status
alt success
  worker -> driver : sensor_channel_get()
  driver --> worker : sample
  worker -> queue : k_msgq_put()
end`),
  template('communication','通信图','Communication diagram','interaction',
    '用 PlantUML 对象与带编号的消息箭头展示协作者及调用次序。',
    'Use PlantUML objects and numbered message arrows to sketch collaborators and call order.',
`object "worker : Sampler" as worker
object "sensor : Driver" as sensor
object "outbox : Queue" as queue
worker --> sensor : 1: fetch()
worker --> sensor : 2: get()
worker --> queue : 3: put(sample)`),
  template('interaction-overview','交互概览图','Interaction overview diagram','interaction',
    '用 PlantUML 活动图的控制流和标有 ref 的步骤组织多个交互。',
    'Use PlantUML activity control flow and steps labeled ref to organize multiple interactions.',
`start
:ref Acquire sample;
if (Read successful?) then (yes)
  :ref Publish result;
else (no)
  :ref Recover sensor;
endif
stop`),
  template('timing','时间图','Timing diagram','interaction',
    '比较线程状态和传感器信号在同一时间轴上的变化。',
    'Compare thread states and sensor signals along a common time axis.',
`robust "Sampler thread" as worker
binary "Data ready" as ready
@0
worker is Waiting
ready is low
@10
ready is high
worker is Running
@15
ready is low
worker is Waiting`)
]);

module.exports={uml_templates};
